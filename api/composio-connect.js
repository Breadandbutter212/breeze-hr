import { Composio } from 'composio-core';

// Auth Config IDs from Composio dashboard (Auth Configs section)
const INTEGRATION_IDS = {
  gmail:   process.env.COMPOSIO_GMAIL_INTEGRATION_ID   || 'ac_c2wnUZ4TgV8S',
  outlook: process.env.COMPOSIO_OUTLOOK_INTEGRATION_ID || null
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
  const integrationId = INTEGRATION_IDS[app];
  const origin = req.headers.origin || 'https://breeze-hr.vercel.app';

  try {
    const client = new Composio({ apiKey });
    const entity = client.getEntity(entityId);

    if (action === 'disconnect') {
      try {
        const connections = await entity.getConnections();
        for (const conn of connections) {
          if ((conn.appName || '').toLowerCase().includes(app.toLowerCase())) {
            await conn.delete();
          }
        }
      } catch(e) { /* best effort */ }
      return res.status(200).json({ disconnected: true });
    }

    if (!integrationId) {
      return res.status(400).json({ error: `No Auth Config found for ${app}. Create one in the Composio dashboard under Auth Configs.` });
    }

    // Use integrationId (the Auth Config ID) — this is the reliable way
    const connection = await entity.initiateConnection({
      integrationId,
      redirectUrl: `${origin}?composio_connected=${app}`
    });

    const authUrl = connection.redirectUrl || connection.redirectUri;
    if (!authUrl) {
      return res.status(502).json({
        error: 'Composio did not return an auth URL.',
        detail: JSON.stringify(connection)
      });
    }

    return res.status(200).json({ authUrl });
  } catch(e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
