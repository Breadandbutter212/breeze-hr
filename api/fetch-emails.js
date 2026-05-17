const BASE = 'https://backend.composio.dev/api/v3';

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

  const user_id = 'user_' + userId.replace(/-/g, '');
  const action = provider === 'outlook' ? 'MICROSOFT_OUTLOOK_GET_EMAILS' : 'GMAIL_FETCH_EMAILS';
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

  const input = {
    query: 'is:inbox',
    max_results: 15,
    maxResults: 15,
    label_ids: ['INBOX']
  };

  // Try different v3 endpoint formats
  const attempts = [
    // Format 1: POST /api/v3/actions/execute with action in body
    {
      url: `${BASE}/actions/execute`,
      body: { action, userId: user_id, input }
    },
    // Format 2: POST /api/v3/toolkits/gmail/actions/{slug}/execute
    {
      url: `${BASE}/toolkits/gmail/actions/${action}/execute`,
      body: { userId: user_id, input }
    },
    // Format 3: connected account specific execute
    connectedAccountId && {
      url: `${BASE}/connected_accounts/${connectedAccountId}/execute`,
      body: { action, input }
    },
    // Format 4: list threads as fallback (also shows inbox emails)
    {
      url: `${BASE}/actions/execute`,
      body: { action: 'GMAIL_LIST_THREADS', userId: user_id, input: { q: 'is:inbox', max_results: 15 } }
    },
    // Format 5: slug format with connected_account_id
    connectedAccountId && {
      url: `${BASE}/actions/${action}/execute`,
      body: { connected_account_id: connectedAccountId, input }
    }
  ].filter(Boolean);

  const results = [];
  for (const attempt of attempts) {
    try {
      const r = await fetch(attempt.url, {
        method: 'POST', headers,
        body: JSON.stringify(attempt.body)
      });
      const raw = await r.text();
      let data;
      try { data = JSON.parse(raw); } catch(e) { data = { raw: raw.substring(0, 200) }; }
      results.push({ url: attempt.url.replace(BASE, ''), status: r.status, data });
      if (r.ok) return res.status(200).json({ _success: true, _url: attempt.url.replace(BASE,''), data });
    } catch(e) {
      results.push({ url: attempt.url.replace(BASE, ''), error: e.message });
    }
  }

  return res.status(404).json({ error: 'All endpoint formats failed', results });
}
