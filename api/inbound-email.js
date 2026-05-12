import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service key for server-side inserts
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const email = req.body;

    // Postmark sends JSON with these fields
    const fromName = email.FromName || email.From?.split('<')[0]?.trim() || 'Unknown';
    const fromEmail = email.FromFull?.Email || email.From || '';
    const subject = email.Subject || '(no subject)';
    const body = email.TextBody || stripHtml(email.HtmlBody) || '';
    const source = 'email';

    // Detect company from To address — find matching company
    // For now default to the test company
    // In production you'd match the To address to a company record
    const toEmail = email.ToFull?.[0]?.Email || email.To || '';

    // Look up company by their inbound email address
    // Companies will register their email address in settings
    const { data: company } = await sb
      .from('companies')
      .select('id')
      .eq('inbound_email', toEmail)
      .single();

    // Fallback — use the test company if no match
    const companyId = company?.id || 'a1b2c3d4-0000-0000-0000-000000000001';

    // Classify message type with simple keyword matching
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

    // Save to messages table
    const { data: message, error } = await sb.from('messages').insert({
      company_id: companyId,
      from_name: fromName,
      from_email: fromEmail,
      source,
      subject: subject.substring(0, 200),
      body: body.substring(0, 10000),
      type,
      status: 'new'
    }).select().single();

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('New message saved:', message.id, 'from', fromEmail);
    return res.status(200).json({ success: true, id: message.id });

  } catch (err) {
    console.error('Inbound email error:', err);
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
