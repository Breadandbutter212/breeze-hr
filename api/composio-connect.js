const COMPOSIO_BASE = 'https://backend.composio.dev/api/v2';

const INTEGRATION_IDS = {
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

  const integrationId = INTEGRATION_IDS[app];
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

  // Use email as entity ID if available - simpler and more readable in Composio dashboard
  const entityId = userEmail ? userEmail.replace(/[^a-zA-Z0-9@._-]/g, '_') : userId.replace(/-/g, '').substring(0, 20);
  const origin = req.headers.origin || 'https://breeze-hr.vercel.app';

  try {
    if (action === 'disconnect') {
      const listRes = await fetch(`${COMPOSIO_BASE}/connectedAccounts?entityId=${encodeURIComponent(entityId)}`, { headers });
      if (listRes.ok) {
        const listData = await listRes.json();
        const items = listData.items || listData.connectedAccounts || [];
        const conn = items.find(c => (c.appName || c.app || '').toLowerCase().includes(app));
        if (conn?.id) {
          await fetch(`${COMPOSIO_BASE}/connectedAccounts/${conn.id}`, { method: 'DELETE', headers });
        }
      }
      return res.status(200).json({ disconnected: true });
    }

    if (!integrationId) {
      return res.status(400).json({ error: `No Auth Config found for ${app}. Add one in Composio dashboard → Auth Configs.` });
    }

    const body = {
      integrationId,
      entityId,
      redirectUri: `${origin}?composio_connected=${app}`
    };

    const initRes = await fetch(`${COMPOSIO_BASE}/connectedAccounts/initiateConnection`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const raw = await initRes.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { raw }; }

    if (!initRes.ok) {
      // Return full detail so we can diagnose exactly what Composio rejects
      return res.status(initRes.status).json({
        error: data.message || data.error || 'Composio error',
        composio_detail: data,
        request_body_sent: body
      });
    }

    const authUrl = data.redirectUrl || data.redirectUri || data.connectionUrl || data.url;
    if (!authUrl) return res.status(502).json({ error: 'No auth URL in Composio response', composio_detail: data });

    return res.status(200).json({ authUrl });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
