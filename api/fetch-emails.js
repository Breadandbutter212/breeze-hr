// v3 is for account management; action execution lives on v2
const BASE_V2 = 'https://backend.composio.dev/api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, provider = 'gmail', connectedAccountId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });

  const entityId = 'user_' + userId.replace(/-/g, '');
  const action = provider === 'outlook' ? 'MICROSOFT_OUTLOOK_GET_EMAILS' : 'GMAIL_FETCH_EMAILS';
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

  const input = { query: 'is:inbox', max_results: 15, maxResults: 15 };

  const attempts = [
    // v2 with entityId
    { url: `${BASE_V2}/actions/${action}/execute`, body: { entityId, input } },
    // v2 with connectedAccountId
    connectedAccountId && { url: `${BASE_V2}/actions/${action}/execute`, body: { connectedAccountId, input } },
    // v2 appName + entityId
    { url: `${BASE_V2}/actions/${action}/execute`, body: { entityId, appName: provider, input } },
    // v2 execute endpoint with action in body
    { url: `${BASE_V2}/actions/execute`, body: { actionName: action, entityId, input } },
    // v2 with text format
    { url: `${BASE_V2}/actions/${action}/execute`, body: { entity_id: entityId, input } },
  ].filter(Boolean);

  const results = [];
  for (const attempt of attempts) {
    try {
      const r = await fetch(attempt.url, {
        method: 'POST', headers, body: JSON.stringify(attempt.body)
      });
      const raw = await r.text();
      let data;
      try { data = JSON.parse(raw); } catch(e) { data = { raw: raw.substring(0, 300) }; }
      results.push({ url: attempt.url.split('/api/')[1], status: r.status, keys: Object.keys(data) });
      if (r.ok) return res.status(200).json({ _success: true, _url: attempt.url.split('/api/')[1], data });
    } catch(e) {
      results.push({ error: e.message });
    }
  }

  return res.status(404).json({ error: 'All attempts failed', results });
}
