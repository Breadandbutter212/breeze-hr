const BASE = 'https://backend.composio.dev/api/v2';

const AUTH_CONFIGS = {
  gmail:   'ac_c2wnUZ4TgV8S',
  outlook: null
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, userEmail, app, action } = req.body;
  if (!userId || !app) return res.status(400).json({ error: 'Missing userId or app' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Composio API key not configured' });

  // Composio entity IDs: user_ prefix + alphanumeric only
  const safeId = (userEmail || userId).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
  const entityId = `user_${safeId}`;
  const origin = req.headers.origin || 'https://breeze-hr.vercel.app';
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

  try {
    if (action === 'disconnect') {
      const lr = await fetch(`${BASE}/connectedAccounts?entityId=${entityId}`, { headers });
      if (lr.ok) {
        const ld = await lr.json();
        const conn = (ld.items || []).find(c => (c.appName || '').toLowerCase().includes(app));
        if (conn?.id) await fetch(`${BASE}/connectedAccounts/${conn.id}`, { method: 'DELETE', headers });
      }
      return res.status(200).json({ disconnected: true });
    }

    const integrationId = AUTH_CONFIGS[app];
    if (!integrationId) return res.status(400).json({ error: `No auth config for ${app}` });

    const body = { integrationId, entityId, redirectUri: origin };

    const r = await fetch(`${BASE}/connectedAccounts/initiateConnection`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { raw }; }

    if (!r.ok) {
      return res.status(r.status).json({
        error: typeof data.message === 'string' ? data.message : raw.substring(0, 400),
        sent: body
      });
    }

    const authUrl = data.redirectUrl || data.redirectUri || data.connectionUrl || data.url;
    if (!authUrl) return res.status(502).json({ error: 'No auth URL in response', data });

    return res.status(200).json({ authUrl });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
