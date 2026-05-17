const BASE_V2 = 'https://backend.composio.dev/api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, provider = 'gmail' } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });

  const entityId = 'user_' + userId.replace(/-/g, '');
  const action = provider === 'outlook' ? 'MICROSOFT_OUTLOOK_GET_EMAILS' : 'GMAIL_FETCH_EMAILS';

  try {
    const r = await fetch(`${BASE_V2}/actions/${action}/execute`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId,
        appName: provider,
        input: { query: 'is:inbox', max_results: 20, maxResults: 20 }
      })
    });
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { raw }; }
    if (!r.ok) return res.status(r.status).json({ error: raw.substring(0, 600), sentEntityId: entityId, sentAction: action });
    return res.status(200).json({ data });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
