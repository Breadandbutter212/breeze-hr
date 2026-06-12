const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL || 'https://uxwmlxbsqhtwexpfcemu.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Webhook authenticity: require a shared secret (configure the provider's webhook URL as ?key=<secret>).
  // Fail closed so anonymous callers cannot inject forged messages.
  const secret = process.env.INBOUND_EMAIL_SECRET;
  const provided = req.query.key || req.headers['x-webhook-secret'];
  if (!secret || provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const email = req.body;

    if (!process.env.SUPABASE_SERVICE_KEY) {
      console.error('SUPABASE_SERVICE_KEY not set');
      return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY env var missing' });
    }

    const fromName = email.FromName || email.From?.split('<')[0]?.trim() || 'Unknown';
    const fromEmail = email.FromFull?.Email || email.From || '';
    const subject = email.Subject || '(no subject)';
    const body = email.TextBody || stripHtml(email.HtmlBody) || '';

    const bodyLower = (subject + ' ' + body).toLowerCase();
    let type = 'General';
    if (bodyLower.match(/matern|pregnant|baby|birth|mat leave/)) type = 'Leave';
    else if (bodyLower.match(/patern|partner.*due|new baby/)) type = 'Leave';
    else if (bodyLower.match(/holiday|annual leave|vacation|time off/)) type = 'Leave';
    else if (bodyLower.match(/sick|illness|unwell|absent|absence/)) type = 'Leave';
    else if (bodyLower.match(/salary|pay|payslip|pension|bonus|benefit/)) type = 'Pay & benefits';
    else if (bodyLower.match(/performance|pip|warning|disciplin/)) type = 'Performance';
    else if (bodyLower.match(/onboard|start|new joiner|first day|joining/)) type = 'Onboarding';
    else if (bodyLower.match(/resign|leav(ing|e the company)|notice period/)) type = 'Offboarding';
    else if (bodyLower.match(/redundan|restructur|at risk/)) type = 'Offboarding';

    const { data: message, error } = await sb.from('messages').insert({
      company_id: 'a1b2c3d4-0000-0000-0000-000000000001',
      from_name: fromName,
      from_email: fromEmail,
      source: 'email',
      subject: subject.substring(0, 200),
      body: body.substring(0, 10000),
      type,
      status: 'new'
    }).select().single();

    if (error) {
      console.error('Supabase error:', JSON.stringify(error));
      return res.status(500).json({ error: error.message });
    }

    console.log('Message saved:', message.id);
    return res.status(200).json({ success: true, id: message.id });

  } catch (err) {
    console.error('Handler error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 10000);
}
