import { Composio } from 'composio-core';

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

  // Sanitise UUID to a Composio-safe entity ID
  const entityId = userId.replace(/-/g, '');

  try {
    const client = new Composio({ apiKey });
    const entity = client.getEntity(entityId);

    if (action === 'disconnect') {
      try {
        const connections = await entity.getConnections();
        for (const conn of connections) {
          if ((conn.appName || '').toLowerCase() === app.toLowerCase()) {
            await conn.delete();
          }
        }
      } catch(e) { /* best effort */ }
      return res.status(200).json({ disconnected: true });
    }

    // Initiate OAuth flow
    const connection = await entity.initiateConnection({ appName: app });
    const authUrl = connection.redirectUrl;
    if (!authUrl) return res.status(502).json({ error: 'No redirect URL returned by Composio', detail: connection });

    return res.status(200).json({ authUrl });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
