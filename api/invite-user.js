import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify caller is authenticated
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const admin = createClient(sbUrl, sbServiceKey);

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { waitlist_id, email, full_name, company_name } = req.body;
  if (!waitlist_id || !email) return res.status(400).json({ error: 'Missing fields' });

  try {
    // Send Supabase invite email
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name, company_name },
      redirectTo: process.env.SITE_URL || 'https://getbreeze.co.uk'
    });
    if (inviteErr) return res.status(500).json({ error: inviteErr.message });

    // Mark as approved in waitlist
    await admin.from('waitlist').update({ status: 'approved' }).eq('id', waitlist_id);

    return res.status(200).json({ ok: true });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
