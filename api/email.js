const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    if (!process.env.SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY missing' });
    }
    const sb = createClient(
      process.env.SUPABASE_URL || 'https://uxwmlxbsqhtwexpfcemu.supabase.co',
      process.env.SUPABASE_SERVICE_KEY
    );
    const e = req.body || {};
    const fromName = e.FromName || 'Unknown';
    const fromEmail = e.FromFull?.Email || e.From || '';
    const subject = e.Subject || '(no subject)';
    const body = (e.TextBody || '').substring(0, 10000);
    const bl = (subject + ' ' + body).toLowerCase();
    let type = 'General';
    if (bl.match(/matern|pregnant|mat leave/)) type = 'Leave';
    else if (bl.match(/holiday|annual leave|time off/)) type = 'Leave';
    else if (bl.match(/sick|illness|absent/)) type = 'Leave';
    else if (bl.match(/salary|pay|pension|bonus/)) type = 'Pay & benefits';
    else if (bl.match(/performance|pip|warning/)) type = 'Performance';
    else if (bl.match(/onboard|new joiner|first day/)) type = 'Onboarding';
    else if (bl.match(/resign|notice period/)) type = 'Offboarding';
    const { data, error } = await sb.from('messages').insert({
      company_id: 'a1b2c3d4-0000-0000-0000-000000000001',
      from_name: fromName,
      from_email: fromEmail,
      source: 'email',
      subject: subject.substring(0, 200),
      body,
      type,
      status: 'new'
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
