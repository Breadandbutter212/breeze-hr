import { createClient } from '@supabase/supabase-js';
import { logAudit, clientIp } from './_audit.js';

const MERGE_BASE = 'https://api.merge.dev/api';
const SUPER_ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function sbAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
}

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await sbAdmin().auth.getUser(token);
  return user || null;
}

// Resolve the user's company + role in one lookup. HRIS data is company-scoped,
// and only company owners/admins may read it or change the connection.
async function getProfile(sb, userId) {
  const { data } = await sb.from('profiles').select('company_id, role').eq('id', userId).single();
  return data || null;
}

function isCompanyAdmin(user, profile) {
  if (SUPER_ADMINS.includes((user.email || '').toLowerCase())) return true;
  const role = (profile?.role || '').toLowerCase();
  return role === 'owner' || role === 'admin' || role === 'hr_admin';
}

// Stored per-company token, else the global env token (single-tenant demo fallback).
async function resolveAccountToken(sb, companyId) {
  if (companyId) {
    const { data } = await sb.from('merge_connections').select('account_token, integration').eq('company_id', companyId).single();
    if (data?.account_token) return { token: data.account_token, integration: data.integration || null, source: 'company' };
  }
  const envTok = process.env.MERGE_ACCOUNT_TOKEN || '';
  if (envTok) return { token: envTok, integration: 'Demo HRIS', source: 'env' };
  return { token: null, integration: null, source: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// HRIS tool-calling chat agent (folded in here to stay under Vercel's Hobby 12
// serverless-function limit). Exposed as POST { action:'chat', messages }. Lets
// Claude call live Merge HRIS tools in a loop to answer workforce data questions
// (who's off, headcount, new joiners, teams, managers, start dates).
// ─────────────────────────────────────────────────────────────────────────────
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const HC_MODELS = { 'claude-sonnet-4-6': 1, 'claude-opus-4-8': 1 };

async function hcMergeGetAll(path, params, apiKey, accountToken, cap = 500) {
  const headers = { 'Authorization': `Bearer ${apiKey}`, 'X-Account-Token': accountToken };
  let all = [], cursor = null;
  while (all.length < cap) {
    const qs = new URLSearchParams({ page_size: '100', ...params });
    if (cursor) qs.set('cursor', cursor);
    const r = await fetch(`${MERGE_BASE}${path}?${qs.toString()}`, { headers });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { throw new Error('Non-JSON from Merge: ' + text.slice(0, 200)); }
    if (!r.ok) throw new Error(data.detail || JSON.stringify(data).slice(0, 200));
    all = all.concat(data.results || []);
    cursor = data.next || null;
    if (!cursor) break;
  }
  return all;
}

function hcMapEmployee(e, idToName) {
  const emp = (e.employments && e.employments[0]) || {};
  const office = e.work_location?.name || e.work_location?.city || e.home_location?.name || e.home_location?.city || '';
  let team = '';
  if (Array.isArray(e.groups) && e.groups.length) {
    const g = e.groups.find(x => /DEPARTMENT|TEAM/i.test(x.type || '')) || e.groups[0];
    team = g?.name || '';
  }
  team = team || e.department || '';
  const managerName = (e.manager && typeof e.manager === 'object' ? e.manager.display_full_name : (typeof e.manager === 'string' ? idToName[e.manager] : '')) || '';
  return {
    name: e.display_full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim(),
    job_title: emp.job_title || e.title || '',
    team, office, manager: managerName,
    start_date: e.start_date ? String(e.start_date).slice(0, 10) : '',
    employment_status: e.employment_status || '',
    email: e.work_email || ''
  };
}

async function hcGetEmployees(apiKey, accountToken) {
  const raw = await hcMergeGetAll('/hris/v1/employees', { expand: 'employments,groups,home_location,work_location,manager' }, apiKey, accountToken);
  const idToName = {};
  raw.forEach(e => { if (e.id) idToName[e.id] = e.display_full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim(); });
  return raw.map(e => hcMapEmployee(e, idToName));
}

function hcWithinRange(startISO, endISO, rangeStart, rangeEnd) {
  const s = startISO ? new Date(startISO) : null;
  const e = endISO ? new Date(endISO) : null;
  if (!s && !e) return false;
  const bs = s || e, be = e || s;
  return bs <= rangeEnd && be >= rangeStart;
}

const HC_TOOLS = [
  {
    name: 'search_employees',
    description: 'Search or list employees in the connected HRIS. Use for questions about who works here, job titles, teams/departments, offices/locations, managers, start dates, new joiners or leavers. Returns matching employees with name, job title, team, office, manager, start date, employment status and email. Omit all filters to list everyone.',
    input_schema: { type: 'object', properties: {
      name: { type: 'string', description: 'Filter by full or partial name (case-insensitive)' },
      team: { type: 'string', description: 'Filter by team/department name (partial match)' },
      office: { type: 'string', description: 'Filter by office/location (partial match)' },
      title: { type: 'string', description: 'Filter by job title keyword (partial match)' },
      started_on_or_after: { type: 'string', description: 'ISO date YYYY-MM-DD - only employees whose start date is on/after this (use for new joiners)' },
      started_on_or_before: { type: 'string', description: 'ISO date YYYY-MM-DD - only employees whose start date is on/before this' },
      employment_status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'PENDING'], description: 'Filter by employment status' }
    } }
  },
  {
    name: 'list_time_off',
    description: 'List time-off / holiday / annual leave / sickness / absence bookings that overlap a date or date range. Use to answer who is off or on leave on a given day or during a period (e.g. "is anyone off on 12 March", "who is on holiday next week"). Returns each booking with employee name, type, status, start and end dates.',
    input_schema: { type: 'object', properties: {
      date: { type: 'string', description: 'A single ISO date YYYY-MM-DD to check who is off that day' },
      start_date: { type: 'string', description: 'ISO date YYYY-MM-DD - start of a range to check' },
      end_date: { type: 'string', description: 'ISO date YYYY-MM-DD - end of a range to check' },
      status: { type: 'string', enum: ['APPROVED', 'ANY'], description: 'APPROVED (default) counts only approved bookings; ANY also includes pending/requested.' }
    } }
  },
  {
    name: 'headcount',
    description: 'Get employee counts, optionally grouped. Use for "how many people/employees/staff" and headcount breakdown questions. Counts active employees only.',
    input_schema: { type: 'object', properties: {
      group_by: { type: 'string', enum: ['team', 'office', 'status', 'none'], description: 'How to break down the counts. "none" (default) returns the total active headcount.' }
    } }
  }
];

async function hcRunTool(name, input, ctx) {
  const { apiKey, accountToken, cache } = ctx;
  if (name === 'search_employees') {
    if (!cache.employees) cache.employees = await hcGetEmployees(apiKey, accountToken);
    let list = cache.employees;
    const has = v => v != null && String(v).trim() !== '';
    const inc = (hay, needle) => (hay || '').toLowerCase().includes(String(needle).toLowerCase());
    if (has(input.name)) list = list.filter(e => inc(e.name, input.name));
    if (has(input.team)) list = list.filter(e => inc(e.team, input.team));
    if (has(input.office)) list = list.filter(e => inc(e.office, input.office));
    if (has(input.title)) list = list.filter(e => inc(e.job_title, input.title));
    if (has(input.employment_status)) list = list.filter(e => (e.employment_status || '').toUpperCase() === input.employment_status.toUpperCase());
    if (has(input.started_on_or_after)) list = list.filter(e => e.start_date && e.start_date >= input.started_on_or_after);
    if (has(input.started_on_or_before)) list = list.filter(e => e.start_date && e.start_date <= input.started_on_or_before);
    return { count: list.length, employees: list.slice(0, 300) };
  }
  if (name === 'list_time_off') {
    const start = input.start_date || input.date;
    const end = input.end_date || input.date || input.start_date;
    if (!start && !end) return { error: 'Provide a date, or a start_date and end_date.' };
    const rangeStart = new Date(`${start}T00:00:00Z`);
    const rangeEnd = new Date(`${end}T23:59:59Z`);
    const params = { expand: 'employee', started_before: `${end}T23:59:59Z`, ended_after: `${start}T00:00:00Z` };
    if ((input.status || 'APPROVED') === 'APPROVED') params.status = 'APPROVED';
    let rows;
    try { rows = await hcMergeGetAll('/hris/v1/time-off', params, apiKey, accountToken, 300); }
    catch (e) { return { error: 'Could not read time-off from the HRIS: ' + e.message }; }
    const keep = input.status === 'ANY' ? ['APPROVED', 'REQUESTED', 'PENDING'] : ['APPROVED'];
    const bookings = rows
      .filter(r => keep.includes((r.status || '').toUpperCase()))
      .filter(r => hcWithinRange(r.start_time, r.end_time, rangeStart, rangeEnd))
      .map(r => ({
        employee: (r.employee && typeof r.employee === 'object') ? (r.employee.display_full_name || `${r.employee.first_name || ''} ${r.employee.last_name || ''}`.trim()) : '',
        type: r.request_type || '', status: r.status || '',
        start: r.start_time ? String(r.start_time).slice(0, 10) : '',
        end: r.end_time ? String(r.end_time).slice(0, 10) : '',
        units: r.units || '', amount: r.amount != null ? r.amount : ''
      }));
    return { checked_range: { start, end }, count: bookings.length, bookings };
  }
  if (name === 'headcount') {
    if (!cache.employees) cache.employees = await hcGetEmployees(apiKey, accountToken);
    const emps = cache.employees;
    const isActive = e => !e.employment_status || e.employment_status.toUpperCase() === 'ACTIVE';
    const active = emps.filter(isActive);
    const byStatus = {};
    emps.forEach(e => { const s = (e.employment_status || 'UNKNOWN').toUpperCase(); byStatus[s] = (byStatus[s] || 0) + 1; });
    // total_records is every record in the HRIS (active + leavers/inactive) - it must match
    // the total shown elsewhere in the app. active is the current-employee subset. Always
    // returned together so the agent can reconcile the two and never give a bare, contradictory number.
    const g = input.group_by || 'none';
    if (g === 'none') return { total_records: emps.length, active: active.length, inactive: emps.length - active.length, by_status: byStatus };
    if (g === 'status') return { total_records: emps.length, active: active.length, inactive: emps.length - active.length, by_status: byStatus };
    const key = g === 'team' ? 'team' : 'office';
    const counts = {};
    active.forEach(e => { const k = e[key] || 'Unknown'; counts[k] = (counts[k] || 0) + 1; });
    return { total_records: emps.length, active: active.length, group_by: g, active_breakdown: counts };
  }
  return { error: `Unknown tool: ${name}` };
}

function hcSystemPrompt() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const pretty = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
  return `You are Breeze HR's workforce data assistant. You answer questions about the company's employees using ONLY the live HRIS tools provided (search_employees, list_time_off, headcount). You are speaking to an HR professional.

Today is ${pretty} (${today}). Resolve relative dates ("next week", "last 3 months", "on the 12th") against today, and pass ISO YYYY-MM-DD dates to the tools.

RULES:
- Always call a tool to get real data. NEVER invent or estimate employees, dates, counts, salaries or leave bookings. If a tool returns nothing, say so plainly (e.g. "No one has time off booked on that date."). Never guess.
- If a name is ambiguous or a question needs a date you don't have, ask one short clarifying question instead of guessing.
- Only report what the tools return. This is the connected HRIS only.
- LINKAGE / "is this live?" - if the user asks whether you are linked or connected to the HRIS, whether the figures are live/real-time, or where the data comes from: answer directly and truthfully - YES, you are connected to their HRIS and the employee figures come live from it via the integration. You are reaching this message BECAUSE the HRIS is connected, so never say you are not linked. You do not need to call a tool just to answer this.
- HEADCOUNT - ALWAYS RECONCILE so the numbers can never look contradictory. The HRIS holds every record: current employees plus leavers/inactive. The headcount tool returns total_records (all records - this matches the total shown elsewhere in the app), active (current employees), and inactive. When you give a headcount, state the active figure AND the total together and how they relate, e.g. "**86 active employees** (108 records in total, including 22 leavers/inactive)." Never give a bare number that could conflict with the total the user sees elsewhere.

FORMATTING (match the rest of the app):
- UK English. holiday (not vacation), annual leave, CV (not resume).
- NEVER use em dashes. Use a single hyphen (-) only.
- Use • for bullet points and **bold** for names/headings. A markdown pipe table is good for lists of people.
- Be concise and skimmable. Lead with the direct answer.`;
}

async function hcAnthropic(model, system, messages, tools) {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1600, system, tools, messages })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || JSON.stringify(data).slice(0, 200));
  return data;
}

async function handleHrisChat(req, res, { apiKey, accountToken }) {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(200).json({ fallback: true });
  const model = HC_MODELS[req.body?.model] ? req.body.model : 'claude-sonnet-4-6';
  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = incoming.slice(-12).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
  if (!messages.length) return res.status(200).json({ fallback: true });
  const ctx = { apiKey, accountToken, cache: {} };
  const system = hcSystemPrompt();
  try {
    for (let step = 0; step < 6; step++) {
      const resp = await hcAnthropic(model, system, messages, HC_TOOLS);
      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content });
        const toolResults = [];
        for (const block of resp.content) {
          if (block.type !== 'tool_use') continue;
          let out;
          try { out = await hcRunTool(block.name, block.input || {}, ctx); }
          catch (e) { out = { error: e.message }; }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out).slice(0, 80000) });
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }
      const text = (resp.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      if (!text) return res.status(200).json({ fallback: true });
      return res.status(200).json({ content: [{ type: 'text', text }] });
    }
    return res.status(200).json({ fallback: true });
  } catch (e) {
    console.error('hris-chat error:', e.message);
    return res.status(200).json({ fallback: true });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = (process.env.MERGE_API_KEY || '').replace(/^Bearer\s+/i, '').trim();
  if (!apiKey) return res.status(500).json({ error: 'MERGE_API_KEY not configured' });

  const sb = sbAdmin();
  const profile = await getProfile(sb, user.id);
  const companyId = profile?.company_id || null;
  const admin = isCompanyAdmin(user, profile);
  const mergeHeaders = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  // ── POST: Merge Link flow (connect / exchange / disconnect) — admins only ──
  if (req.method === 'POST') {
    const { action, public_token } = req.body || {};

    // HRIS chat agent: workforce data questions. Admin-only (company PII); on any miss we
    // return { fallback:true } so the app cleanly drops back to the normal chat path.
    if (action === 'chat') {
      if (!admin) return res.status(200).json({ fallback: true });
      const { token: chatToken } = await resolveAccountToken(sb, companyId);
      if (!chatToken) return res.status(200).json({ fallback: true });
      return handleHrisChat(req, res, { apiKey, accountToken: chatToken });
    }

    if (!companyId) return res.status(403).json({ error: 'No company on profile' });
    if (!admin) return res.status(403).json({ error: 'Only a company owner or admin can manage the HRIS connection' });

    // 1. Mint a short-lived Link token, bound to this company via end_user_origin_id.
    if (action === 'link-token') {
      try {
        const r = await fetch(`${MERGE_BASE}/integrations/create-link-token`, {
          method: 'POST', headers: mergeHeaders,
          body: JSON.stringify({
            end_user_origin_id: companyId,                        // tenant binding: this company only
            end_user_organization_name: 'Breeze HR Customer',
            end_user_email_address: user.email || `${user.id}@breeze.local`,
            categories: ['hris'],                                 // add 'ats','payroll' etc. to widen scope
          }),
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.detail || JSON.stringify(data) });
        return res.status(200).json({ link_token: data.link_token, magic_link_url: data.magic_link_url || null });
      } catch (e) { return res.status(500).json({ error: e.message }); }
    }

    // 2. Swap the public_token for a permanent account token, but only store it after
    //    confirming Merge reports this linked account under THIS company's origin id.
    if (action === 'exchange') {
      if (!public_token) return res.status(400).json({ error: 'Missing public_token' });
      try {
        const r = await fetch(`${MERGE_BASE}/integrations/account-token/${encodeURIComponent(public_token)}`, { headers: mergeHeaders });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.detail || JSON.stringify(data) });
        const account_token = data.account_token;
        const integration = data.integration?.name || data.integration || null;
        if (!account_token) return res.status(502).json({ error: 'No account_token from Merge' });

        // Tenant-binding check: the linked account must belong to this company's origin id.
        const lr = await fetch(`${MERGE_BASE}/integrations/linked-accounts?end_user_origin_id=${encodeURIComponent(companyId)}`, { headers: mergeHeaders });
        if (!lr.ok) return res.status(502).json({ error: 'Could not verify linked account ownership, please retry' });
        const ld = await lr.json();
        const owned = (ld.results || []).some(a => a.end_user_origin_id === companyId);
        if (!owned) return res.status(403).json({ error: 'Linked account does not belong to your company' });

        await sb.from('merge_connections').upsert({
          company_id: companyId, account_token, integration, connected_at: new Date().toISOString(),
        }, { onConflict: 'company_id' });
        await logAudit(sb, { company_id: companyId, user_id: user.id, user_email: user.email || null, action: 'hris.connect', ip: clientIp(req), detail: { integration: integration || null } });
        return res.status(200).json({ connected: true, integration });
      } catch (e) { return res.status(500).json({ error: e.message }); }
    }

    // 3. Forget the stored token for this company.
    if (action === 'disconnect') {
      await sb.from('merge_connections').delete().eq('company_id', companyId);
      await logAudit(sb, { company_id: companyId, user_id: user.id, user_email: user.email || null, action: 'hris.disconnect', ip: clientIp(req) });
      return res.status(200).json({ disconnected: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token: accountToken, integration, source } = await resolveAccountToken(sb, companyId);

  // ── GET ?action=status: connection state (any company member may see this) ──
  // Only a real per-company link counts as "connected" — the global demo env token
  // must not mask the Connect button, or users can never open Merge Link to pick a platform.
  if (req.query.action === 'status') {
    const realConnection = source === 'company';
    return res.status(200).json({ connected: realConnection, integration: realConnection ? integration : null });
  }

  // ── GET (default): pull all employees — company-wide PII, so admins only ──
  if (!admin) return res.status(403).json({ error: 'Only a company owner or admin can read HRIS employee data' });
  if (!accountToken) return res.status(409).json({ error: 'No HRIS connected', connected: false });

  try {
    let allEmployees = [];
    let cursor = null;
    while (true) {
      const base = `${MERGE_BASE}/hris/v1/employees?page_size=100&expand=employments,company`;
      const url = cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
      const response = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}`, 'X-Account-Token': accountToken } });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { return res.status(502).json({ error: 'Non-JSON from Merge', raw: text.substring(0, 300) }); }
      if (!response.ok) return res.status(response.status).json(data);
      allEmployees = allEmployees.concat(data.results || []);
      cursor = data.next || null;
      if (!cursor) break;
    }
    return res.status(200).json({ results: allEmployees, integration });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
