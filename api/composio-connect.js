import { Composio } from 'composio-core';

// Map frontend app names to Composio app slugs
const APP_NAMES = {
  gmail: 'gmail',
  outlook: 'outlook'
};

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

  const entityId = userId.replace(/-/g, '');
  const appName = APP_NAMES[app] || app;
  const origin = req.headers.origin || 'https://breeze-hr.vercel.app';

  try {
    const client = new Composio({ apiKey });
    const entity = client.getEntity(entityId);

    if (action === 'disconnect') {
      try {
        const connections = await entity.getConnections();
        for (const conn of connections) {
          if ((conn.appName || '').toLowerCase() === appName.toLowerCase()) {
            await conn.delete();
          }
        }
      } catch(e) { /* best effort */ }
      return res.status(200).json({ disconnected: true });
    }

    // Initiate OAuth — include redirectUrl and authMode so Composio
    // has everything it needs for the v2 initiateConnection endpoint
    const connection = await entity.initiateConnection({
      appName,
      authMode: 'OAUTH2',
      redirectUrl: `${origin}?composio_connected=${appName}`
    });

    const authUrl = connection.redirectUrl || connection.redirectUri;
    if (!authUrl) {
      return res.status(502).json({
        error: 'Composio did not return an auth URL. Check that an Auth Config for ' + appName + ' exists in your Composio dashboard.',
        detail: JSON.stringify(connection)
      });
    }

    return res.status(200).json({ authUrl });
  } catch(e) {
    // Surface the full Composio error message so it's visible in the UI
    const msg = e?.message || String(e);
    return res.status(500).json({ error: msg });
  }
}
