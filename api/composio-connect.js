import { Composio } from '@composio/core';

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

  try {
    const composio = new Composio({ apiKey });
    const entity = await composio.getEntity(userId);

    if (action === 'disconnect') {
      try {
        const connections = await entity.getConnections();
        const conn = connections.find(c => c.appName === app);
        if (conn) await conn.delete();
      } catch(e) {}
      return res.status(200).json({ disconnected: true });
    }

    // Initiate connection - redirect back to settings after auth
    const redirectUrl = `${req.headers.origin || 'https://breeze-hr.vercel.app'}/settings`;
    const connection = await entity.initiateConnection({
      appName: app,
      redirectUrl
    });

    return res.status(200).json({ authUrl: connection.redirectUrl });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
