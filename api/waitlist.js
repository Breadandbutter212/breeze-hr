import { createClient } from '@supabase/supabase-js';

function getAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  );
}

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await getAdmin().auth.getUser(token);
  return user || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = getAdmin();
  const { action } = req.query;

  // POST /api/waitlist?action=join — public, no auth needed
  if (req.method === 'POST' && action === 'join') {
    const { full_name, email, company_name } = req.body;
    if (!full_name || !email || !company_name) return res.status(400).json({ error: 'All fields required' });
    const { error } = await admin.from('waitlist').insert({ full_name, email, company_name });
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'already_registered' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  }

  // All other actions require auth AND admin
  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'dwgordon7@icloud.com').split(',').map(e => e.trim().toLowerCase());
  if (!ADMIN_EMAILS.includes((user.email || '').toLowerCase())) return res.status(403).json({ error: 'Forbidden' });

  // GET /api/waitlist?action=list
  if (req.method === 'GET' && action === 'list') {
    const { data, error } = await admin.from('waitlist').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ data });
  }

  // POST /api/waitlist?action=invite
  if (req.method === 'POST' && action === 'invite') {
    const { waitlist_id, email, full_name, company_name } = req.body;
    if (!waitlist_id || !email) return res.status(400).json({ error: 'Missing fields' });
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name, company_name },
      redirectTo: process.env.SITE_URL || 'https://getbreeze.co.uk'
    });
    if (inviteErr) return res.status(500).json({ error: inviteErr.message });
    await admin.from('waitlist').update({ status: 'approved' }).eq('id', waitlist_id);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
