import { createClient } from '@supabase/supabase-js';

const MERGE_BASE = 'https://api.merge.dev/api';

function sbAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
}

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await sbAdmin().auth.getUser(token);
  return user || null;
}

// Resolve the company this user belongs to (HRIS connections are company-level).
async function getCompanyId(sb, userId) {
  const { data } = await sb.from('profiles').select('company_id').eq('id', userId).single();
  return data?.company_id || null;
}

// Look up the stored Merge account token for a company, else fall back to the
// single global env token (keeps the original single-tenant prototype working).
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
  const mergeHeaders = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  // ── POST: Merge Link flow (connect / exchange / disconnect) ──
  if (req.method === 'POST') {
    const { action, public_token } = req.body || {};
    const companyId = await getCompanyId(sb, user.id);

    // 1. Mint a short-lived Link token so the browser can open Merge Link.
    if (action === 'link-token') {
      try {
        const r = await fetch(`${MERGE_BASE}/integrations/create-link-token`, {
          method: 'POST', headers: mergeHeaders,
          body: JSON.stringify({
            end_user_origin_id: companyId || user.id,            // stable id for this customer
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

    // 2. Swap the public_token (from a successful Link) for a permanent account token, then store it.
    if (action === 'exchange') {
      if (!public_token) return res.status(400).json({ error: 'Missing public_token' });
      try {
        const r = await fetch(`${MERGE_BASE}/integrations/account-token/${encodeURIComponent(public_token)}`, { headers: mergeHeaders });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.detail || JSON.stringify(data) });
        const account_token = data.account_token;
        const integration = data.integration?.name || data.integration || null;
        if (!account_token) return res.status(502).json({ error: 'No account_token from Merge' });
        if (companyId) {
          await sb.from('merge_connections').upsert({
            company_id: companyId, account_token, integration, connected_at: new Date().toISOString(),
          }, { onConflict: 'company_id' });
        }
        return res.status(200).json({ connected: true, integration, stored: !!companyId });
      } catch (e) { return res.status(500).json({ error: e.message }); }
    }

    // 3. Forget the stored token for this company.
    if (action === 'disconnect') {
      if (companyId) await sb.from('merge_connections').delete().eq('company_id', companyId);
      return res.status(200).json({ disconnected: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = await getCompanyId(sb, user.id);
  const { token: accountToken, integration } = await resolveAccountToken(sb, companyId);

  // ── GET ?action=status: is an HRIS connected for this company? ──
  if (req.query.action === 'status') {
    return res.status(200).json({ connected: !!accountToken, integration });
  }

  // ── GET (default): pull all employees from the connected HRIS ──
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
