import { createClient } from '@supabase/supabase-js';

// HRIS chat agent - answers workforce data questions (who's off, headcount, new joiners,
// teams, managers, start dates) by letting Claude call live Merge HRIS tools in a loop.
// This is additive: the app only routes people/roster/time-off questions here. Anything
// else - and any miss (no HRIS, not an admin, an error) - returns { fallback:true } so the
// caller cleanly falls back to the normal chat path. It never changes normal chat.

const MERGE_BASE = 'https://api.merge.dev/api';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const SUPER_ADMINS = (process.env.ADMIN_EMAILS || 'dwgordon7@icloud.com').split(',').map(e => e.trim().toLowerCase());
const MODELS = { 'claude-sonnet-4-6': 1, 'claude-opus-4-8': 1 };

function sbAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
}

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try { const { data: { user } } = await sbAdmin().auth.getUser(token); return user || null; }
  catch { return null; }
}

async function getProfile(sb, userId) {
  const { data } = await sb.from('profiles').select('company_id, role').eq('id', userId).single();
  return data || null;
}

function isCompanyAdmin(user, profile) {
  if (SUPER_ADMINS.includes((user.email || '').toLowerCase())) return true;
  const role = (profile?.role || '').toLowerCase();
  return role === 'owner' || role === 'admin' || role === 'hr_admin';
}

// Stored per-company token, else the global env token (single-tenant demo fallback) - mirrors merge-search.js.
async function resolveAccountToken(sb, companyId) {
  if (companyId) {
    const { data } = await sb.from('merge_connections').select('account_token, integration').eq('company_id', companyId).single();
    if (data?.account_token) return { token: data.account_token, integration: data.integration || null };
  }
  const envTok = process.env.MERGE_ACCOUNT_TOKEN || '';
  if (envTok) return { token: envTok, integration: 'Demo HRIS' };
  return { token: null, integration: null };
}

// ── Merge fetch helpers ──────────────────────────────────────────────────────
async function mergeGetAll(path, params, apiKey, accountToken, cap = 500) {
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

// ── Data mapping ─────────────────────────────────────────────────────────────
function mapEmployee(e, idToName) {
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
    team,
    office,
    manager: managerName,
    start_date: e.start_date ? String(e.start_date).slice(0, 10) : '',
    employment_status: e.employment_status || '',
    email: e.work_email || ''
  };
}

let _empCache = null; // per warm instance, cleared each request below to stay fresh
async function getEmployees(apiKey, accountToken) {
  const raw = await mergeGetAll('/hris/v1/employees', { expand: 'employments,groups,home_location,work_location,manager' }, apiKey, accountToken);
  const idToName = {};
  raw.forEach(e => { if (e.id) idToName[e.id] = e.display_full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim(); });
  return raw.map(e => mapEmployee(e, idToName));
}

function withinRange(startISO, endISO, rangeStart, rangeEnd) {
  const s = startISO ? new Date(startISO) : null;
  const e = endISO ? new Date(endISO) : null;
  if (!s && !e) return false;
  const bs = s || e, be = e || s;
  return bs <= rangeEnd && be >= rangeStart;
}

// ── Tool definitions given to Claude ─────────────────────────────────────────
const TOOLS = [
  {
    name: 'search_employees',
    description: 'Search or list employees in the connected HRIS. Use for questions about who works here, job titles, teams/departments, offices/locations, managers, start dates, new joiners or leavers. Returns matching employees with name, job title, team, office, manager, start date, employment status and email. Omit all filters to list everyone.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Filter by full or partial name (case-insensitive)' },
        team: { type: 'string', description: 'Filter by team/department name (partial match)' },
        office: { type: 'string', description: 'Filter by office/location (partial match)' },
        title: { type: 'string', description: 'Filter by job title keyword (partial match)' },
        started_on_or_after: { type: 'string', description: 'ISO date YYYY-MM-DD - only employees whose start date is on/after this (use for new joiners)' },
        started_on_or_before: { type: 'string', description: 'ISO date YYYY-MM-DD - only employees whose start date is on/before this' },
        employment_status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'PENDING'], description: 'Filter by employment status' }
      }
    }
  },
  {
    name: 'list_time_off',
    description: 'List time-off / holiday / annual leave / sickness / absence bookings that overlap a date or date range. Use to answer who is off or on leave on a given day or during a period (e.g. "is anyone off on 12 March", "who is on holiday next week"). Returns each booking with employee name, type, status, start and end dates.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'A single ISO date YYYY-MM-DD to check who is off that day' },
        start_date: { type: 'string', description: 'ISO date YYYY-MM-DD - start of a range to check' },
        end_date: { type: 'string', description: 'ISO date YYYY-MM-DD - end of a range to check' },
        status: { type: 'string', enum: ['APPROVED', 'ANY'], description: 'APPROVED (default) counts only approved bookings; ANY also includes pending/requested bookings.' }
      }
    }
  },
  {
    name: 'headcount',
    description: 'Get employee counts, optionally grouped. Use for "how many people/employees/staff" and headcount breakdown questions. Counts active employees only.',
    input_schema: {
      type: 'object',
      properties: {
        group_by: { type: 'string', enum: ['team', 'office', 'status', 'none'], description: 'How to break down the counts. "none" (default) returns the total active headcount.' }
      }
    }
  }
];

// ── Tool execution ───────────────────────────────────────────────────────────
async function runTool(name, input, ctx) {
  const { apiKey, accountToken } = ctx;
  if (name === 'search_employees') {
    if (!_empCache) _empCache = await getEmployees(apiKey, accountToken);
    let list = _empCache;
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
    const params = {
      expand: 'employee',
      started_before: `${end}T23:59:59Z`,
      ended_after: `${start}T00:00:00Z`
    };
    if ((input.status || 'APPROVED') === 'APPROVED') params.status = 'APPROVED';
    let rows;
    try { rows = await mergeGetAll('/hris/v1/time-off', params, apiKey, accountToken, 300); }
    catch (e) { return { error: 'Could not read time-off from the HRIS: ' + e.message }; }
    const keepStatuses = input.status === 'ANY' ? ['APPROVED', 'REQUESTED', 'PENDING'] : ['APPROVED'];
    const bookings = rows
      .filter(r => keepStatuses.includes((r.status || '').toUpperCase()) || input.status !== 'ANY' && (r.status || '').toUpperCase() === 'APPROVED')
      .filter(r => withinRange(r.start_time, r.end_time, rangeStart, rangeEnd))
      .map(r => ({
        employee: (r.employee && typeof r.employee === 'object') ? (r.employee.display_full_name || `${r.employee.first_name || ''} ${r.employee.last_name || ''}`.trim()) : '',
        type: r.request_type || '',
        status: r.status || '',
        start: r.start_time ? String(r.start_time).slice(0, 10) : '',
        end: r.end_time ? String(r.end_time).slice(0, 10) : '',
        units: r.units || '',
        amount: r.amount != null ? r.amount : ''
      }));
    return { checked_range: { start, end }, count: bookings.length, bookings };
  }

  if (name === 'headcount') {
    if (!_empCache) _empCache = await getEmployees(apiKey, accountToken);
    const active = _empCache.filter(e => !e.employment_status || e.employment_status.toUpperCase() === 'ACTIVE');
    const g = input.group_by || 'none';
    if (g === 'none') return { total_active: active.length };
    const key = g === 'team' ? 'team' : g === 'office' ? 'office' : 'employment_status';
    const counts = {};
    active.forEach(e => { const k = e[key] || 'Unknown'; counts[k] = (counts[k] || 0) + 1; });
    return { total_active: active.length, group_by: g, breakdown: counts };
  }

  return { error: `Unknown tool: ${name}` };
}

// ── Anthropic tool-use loop ──────────────────────────────────────────────────
function systemPrompt() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const pretty = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
  return `You are Breeze HR's workforce data assistant. You answer questions about the company's employees using ONLY the live HRIS tools provided (search_employees, list_time_off, headcount). You are speaking to an HR professional.

Today is ${pretty} (${today}). Resolve relative dates ("next week", "last 3 months", "on the 12th") against today, and pass ISO YYYY-MM-DD dates to the tools.

RULES:
- Always call a tool to get real data. NEVER invent employees, dates, counts or leave bookings. If a tool returns nothing, say so plainly (e.g. "No one has time off booked on that date.").
- If a name is ambiguous or a question needs a date you don't have, ask one short clarifying question instead of guessing.
- Only report what the tools return. This is the connected HRIS only.

FORMATTING (match the rest of the app):
- UK English. holiday (not vacation), annual leave, CV (not resume).
- NEVER use em dashes. Use a single hyphen (-) only.
- Use • for bullet points and **bold** for names/headings. A markdown pipe table is good for lists of people.
- Be concise and skimmable. Lead with the direct answer.`;
}

async function anthropic(model, system, messages, tools) {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: 1600, system, tools, messages })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || JSON.stringify(data).slice(0, 200));
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = (process.env.MERGE_API_KEY || '').replace(/^Bearer\s+/i, '').trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !anthropicKey) return res.status(200).json({ fallback: true });

  const sb = sbAdmin();
  const profile = await getProfile(sb, user.id);
  // Company-wide employee PII - admins only, same rule as merge-search.js. Anyone else
  // falls back to normal chat (which has no HRIS access, so no data leaks).
  if (!isCompanyAdmin(user, profile)) return res.status(200).json({ fallback: true });

  const { token: accountToken } = await resolveAccountToken(sb, profile?.company_id || null);
  if (!accountToken) return res.status(200).json({ fallback: true });

  const model = MODELS[req.body?.model] ? req.body.model : 'claude-sonnet-4-6';
  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  // Keep only role/content and cap history to bound cost - the last turns carry the question.
  const messages = incoming.slice(-12).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
  if (!messages.length) return res.status(200).json({ fallback: true });

  _empCache = null; // fresh per request so reconnected/changed rosters are picked up
  const ctx = { apiKey, accountToken };
  const system = systemPrompt();

  try {
    for (let step = 0; step < 6; step++) {
      const resp = await anthropic(model, system, messages, TOOLS);
      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content });
        const toolResults = [];
        for (const block of resp.content) {
          if (block.type !== 'tool_use') continue;
          let out;
          try { out = await runTool(block.name, block.input || {}, ctx); }
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
    // Ran out of steps - let the caller fall back rather than return a half-answer.
    return res.status(200).json({ fallback: true });
  } catch (e) {
    console.error('hris-chat error:', e.message);
    return res.status(200).json({ fallback: true });
  }
}
