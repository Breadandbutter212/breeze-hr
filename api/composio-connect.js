const COMPOSIO_BASE = 'https://backend.composio.dev/api/v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, app, action } = req.body;
  if (!userId || !app) return res.status(400).json({ error: 'Missing userId or app' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Composio API key not configured' });

  // Use a safe entity ID (email-safe alphanumeric)
  const entityId = userId.replace(/[^a-zA-Z0-9._-]/g, '_');

  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

  try {
    if (action === 'disconnect') {
      // Find and delete active connection for this app+entity
      const listRes = await fetch(`${COMPOSIO_BASE}/connectedAccounts?entityId=${encodeURIComponent(entityId)}&status=ACTIVE`, { headers });
      if (listRes.ok) {
        const listData = await listRes.json();
        const conn = (listData.items || []).find(c => c.appName?.toLowerCase() === app.toLowerCase());
        if (conn?.id) {
          await fetch(`${COMPOSIO_BASE}/connectedAccounts/${conn.id}`, { method: 'DELETE', headers });
        }
      }
      return res.status(200).json({ disconnected: true });
    }

    // Initiate OAuth connection
    const body = {
      appName: app,
      entityId,
      redirectUri: `${req.headers.origin || 'https://breeze-hr.vercel.app'}?connected=${app}`
    };

    const initRes = await fetch(`${COMPOSIO_BASE}/connectedAccounts`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const text = await initRes.text();
    let data;
    try { data = JSON.parse(text); } catch(e) {
      return res.status(502).json({ error: 'Bad response from Composio', raw: text.substring(0, 300) });
    }

    if (!initRes.ok) return res.status(initRes.status).json({ error: data.message || data.error || 'Composio error', detail: data });

    const authUrl = data.redirectUrl || data.redirectUri || data.connectionUrl;
    if (!authUrl) return res.status(502).json({ error: 'No auth URL returned', detail: data });

    return res.status(200).json({ authUrl });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
