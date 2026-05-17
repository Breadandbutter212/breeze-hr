const BASE = 'https://backend.composio.dev/api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, app, action, connectedAccountId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });

  const entityId = 'user_' + userId.replace(/-/g, '');
  const origin = req.headers.origin || 'https://breeze-hr.vercel.app';
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

  try {
    if (action === 'disconnect') {
      if (connectedAccountId) {
        await fetch(`${BASE}/connectedAccounts/${connectedAccountId}`, { method: 'DELETE', headers });
      }
      return res.status(200).json({ disconnected: true });
    }

    if (!app) return res.status(400).json({ error: 'Missing app' });

    const body = {
      integrationId: 'ac_c2wnUZ4TgV8S',
      entityId,
      redirectUri: origin
    };

    const r = await fetch(`${BASE}/connectedAccounts/initiateConnection`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { raw }; }

    if (!r.ok) {
      return res.status(r.status).json({ error: raw.substring(0, 500), sent: body });
    }

    const authUrl = data.redirectUrl || data.redirectUri || data.connectionUrl || data.url;
    if (!authUrl) return res.status(502).json({ error: 'No auth URL', data });

    return res.status(200).json({ authUrl });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
