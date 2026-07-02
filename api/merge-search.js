import { createClient } from '@supabase/supabase-js';
import { logAudit, clientIp } from './_audit.js';

const MERGE_BASE = 'https://api.merge.dev/api';
const SUPER_ADMINS = (process.env.ADMIN_EMAILS || 'dwgordon7@icloud.com').split(',').map(e => e.trim().toLowerCase());

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
