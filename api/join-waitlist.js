import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { full_name, email, company_name } = req.body;
  if (!full_name || !email || !company_name) {
    return res.status(400).json({ error: 'All fields required' });
  }

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  );

  const { error } = await sb.from('waitlist').insert({ full_name, email, company_name });
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'already_registered' });
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true });
}
