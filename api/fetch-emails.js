const BASE = 'https://backend.composio.dev/api/v3';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, provider = 'gmail', query = '', maxResults = 15 } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });

  const user_id = 'user_' + userId.replace(/-/g, '');

  // Try multiple possible action names
  const actions = provider === 'outlook'
    ? ['MICROSOFT_OUTLOOK_GET_EMAILS', 'OUTLOOK_GET_EMAILS', 'OUTLOOK_FETCH_EMAILS']
    : ['GMAIL_FETCH_EMAILS', 'GMAIL_GET_MESSAGES', 'GMAIL_LIST_MESSAGES'];

  for (const action of actions) {
    try {
      const r = await fetch(`${BASE}/actions/${action}/execute`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user_id,
          input: {
            query: query || 'is:inbox',
            max_results: maxResults,
            maxResults,
            label_ids: ['INBOX']
          }
        })
      });

      if (r.status === 404) continue; // try next action name

      const raw = await r.text();
      let data;
      try { data = JSON.parse(raw); } catch(e) { data = { raw: raw.substring(0, 200) }; }

      // Return raw so frontend can see the structure
      return res.status(200).json({ _action: action, _raw: data });
    } catch(e) {
      continue;
    }
  }

  return res.status(404).json({ error: 'No working Gmail action found', tried: actions });
}
