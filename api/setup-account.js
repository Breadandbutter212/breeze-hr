import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify the caller is authenticated
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!sbUrl || (!sbServiceKey && !sbAnonKey)) {
    return res.status(500).json({ error: 'Supabase env vars not set' });
  }

  // Verify the token using anon client
  const anonClient = createClient(sbUrl, sbServiceKey || sbAnonKey);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // Use service role key to bypass RLS for account setup
  const admin = createClient(sbUrl, sbServiceKey || sbAnonKey, {
    auth: { persistSession: false }
  });

  const { full_name, company_name } = req.body;

  try {
    // Check if profile already exists (idempotent)
    const { data: existing } = await admin.from('profiles').select('id').eq('id', user.id).single();
    if (existing) return res.status(200).json({ ok: true, already_exists: true });

    // Create company
    const { data: co, error: coErr } = await admin
      .from('companies')
      .insert({ name: company_name || 'My Company' })
      .select()
      .single();
    if (coErr || !co) return res.status(500).json({ error: 'Failed to create company: ' + (coErr?.message || '') });

    // Create profile
    const { error: profErr } = await admin
      .from('profiles')
      .insert({ id: user.id, company_id: co.id, full_name: full_name || '', role: 'owner' });
    if (profErr) return res.status(500).json({ error: 'Failed to create profile: ' + profErr.message });

    return res.status(200).json({ ok: true, company_id: co.id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
