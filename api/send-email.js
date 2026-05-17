const BASE = 'https://backend.composio.dev/api/v3';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, to, subject, body, provider = 'gmail' } = req.body;
  if (!userId || !to || !body) return res.status(400).json({ error: 'Missing required fields' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });

  const user_id = 'user_' + userId.replace(/-/g, '');
  const action = provider === 'outlook' ? 'MICROSOFT_OUTLOOK_SEND_EMAIL' : 'GMAIL_SEND_EMAIL';

  try {
    const r = await fetch(`${BASE}/actions/${action}/execute`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user_id,
        input: { to, subject: subject || 'Letter from HR', messageBody: body }
      })
    });

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { raw }; }

    if (!r.ok) return res.status(r.status).json({ error: raw.substring(0, 400) });
    return res.status(200).json({ success: true, data });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
