import { createClient } from '@supabase/supabase-js';
import { logAudit, clientIp, ALLOWED_ACTIONS } from './_audit.js';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const sb = sbAdmin();
  // Company + role are resolved server-side from the caller's profile - never trusted from the client.
  const { data: prof } = await sb.from('profiles').select('company_id, role').eq('id', user.id).single();
  const companyId = prof?.company_id || null;

  // POST: record a client-side security event (login, download, settings change...)
  if (req.method === 'POST') {
    const { action, detail } = req.body || {};
    if (!ALLOWED_ACTIONS.has(action)) return res.status(400).json({ error: 'Unknown action' });
    await logAudit(sb, {
      company_id: companyId,
      user_id: user.id,
      user_email: user.email || null,
      action,
      detail,
      ip: clientIp(req),
    });
    return res.status(200).json({ ok: true });
  }

  // GET ?action=list: admins read their own company's recent events
  if (req.method === 'GET' && req.query.action === 'list') {
    const role = (prof?.role || '').toLowerCase();
    const isAdmin = SUPER_ADMINS.includes((user.email || '').toLowerCase()) || ['owner', 'admin', 'hr_admin'].includes(role);
    if (!isAdmin) return res.status(403).json({ error: 'Admins only' });
    if (!companyId) return res.status(200).json({ events: [] });
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const { data, error } = await sb.from('audit_events')
      .select('id, user_email, action, detail, ip, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ events: data || [] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
