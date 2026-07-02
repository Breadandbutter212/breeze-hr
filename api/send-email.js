import { createClient } from '@supabase/supabase-js';
import { logAudit, clientIp } from './_audit.js';

const BASE = 'https://backend.composio.dev/api/v3.1';

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
  const { data: { user } } = await sb.auth.getUser(token);
  return user || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, to, cc, bcc, subject, body, provider = 'gmail', threadId, inReplyTo } = req.body;
  if (!userId || !to || !body) return res.status(400).json({ error: 'Missing required fields' });
  if (userId !== user.id) return res.status(403).json({ error: 'Forbidden' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });

  const user_id = 'user_' + userId.replace(/-/g, '');

  // Use dedicated reply action when threading into an existing Gmail thread
  const isGmailReply = provider !== 'outlook' && !!threadId;
  const action = provider === 'outlook'
    ? 'MICROSOFT_OUTLOOK_SEND_EMAIL'
    : isGmailReply ? 'GMAIL_REPLY_TO_THREAD' : 'GMAIL_SEND_EMAIL';

  const args = isGmailReply
    ? { thread_id: threadId, message_body: body, recipient_email: to, ...(cc ? { cc } : {}), ...(bcc ? { bcc } : {}) }
    : provider === 'outlook'
      ? { to, subject: subject || 'Letter from HR', body, ...(cc ? { cc } : {}), ...(bcc ? { bcc } : {}) }
      : { recipient_email: to, subject: subject || 'Letter from HR', body, ...(cc ? { cc } : {}), ...(bcc ? { bcc } : {}) };

  try {
    const r = await fetch(`${BASE}/tools/execute/${action}`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id, arguments: args })
    });

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { raw }; }

    if (!r.ok) return res.status(r.status).json({ error: raw.substring(0, 400) });

    // Audit the send (server-side, tamper-proof). Record metadata only, never the body/recipient PII.
    try {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
      const { data: prof } = await sb.from('profiles').select('company_id').eq('id', user.id).single();
      const toDomain = String(to || '').split('@')[1] || null;
      await logAudit(sb, {
        company_id: prof?.company_id || null, user_id: user.id, user_email: user.email || null,
        action: 'email.send', ip: clientIp(req),
        detail: { provider, reply: !!threadId, to_domain: toDomain },
      });
    } catch (e) { /* audit must not affect the send result */ }

    return res.status(200).json({ success: true, data });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
