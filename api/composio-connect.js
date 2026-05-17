// Direct Composio v2 REST — no SDK, no schema validation issues
const BASE = 'https://backend.composio.dev/api/v2';

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

  // Strictly safe entity ID: letters, numbers, underscores, hyphens only
  const entityId = (userEmail || userId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const origin = req.headers.origin || 'https://breeze-hr.vercel.app';
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

  try {
    if (action === 'disconnect') {
      const lr = await fetch(`${BASE}/connectedAccounts?entityId=${encodeURIComponent(entityId)}`, { headers });
      if (lr.ok) {
        const ld = await lr.json();
        const items = ld.items || ld.connectedAccounts || [];
        const conn = items.find(c => (c.appName || '').toLowerCase().includes(app));
        if (conn?.id) await fetch(`${BASE}/connectedAccounts/${conn.id}`, { method: 'DELETE', headers });
      }
      return res.status(200).json({ disconnected: true });
    }

    // Try with integrationId first, fall back to appName only
    const body = {
      integrationId: 'ac_c2wnUZ4TgV8S',
      entityId,
      redirectUri: origin
    };

    let r = await fetch(`${BASE}/connectedAccounts/initiateConnection`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });

    // If integrationId format is rejected, retry with appName only
    if (!r.ok) {
      const fallbackBody = { appName: app, entityId };
      r = await fetch(`${BASE}/connectedAccounts/initiateConnection`, {
        method: 'POST', headers, body: JSON.stringify(fallbackBody)
      });
    }

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { raw }; }

    if (!r.ok) {
      // Stringify whatever Composio returns so it's always readable
      const errMsg = typeof data.message === 'string' ? data.message
                   : typeof data.error === 'string'   ? data.error
                   : raw.substring(0, 500);
      return res.status(r.status).json({ error: errMsg, raw: raw.substring(0, 500) });
    }

    const authUrl = data.redirectUrl || data.redirectUri || data.connectionUrl;
    if (!authUrl) return res.status(502).json({ error: 'No auth URL returned', detail: data });

    return res.status(200).json({ authUrl });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
