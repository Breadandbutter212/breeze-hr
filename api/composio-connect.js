import { Composio } from '@composio/core';

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
  const origin = req.headers.origin || 'https://breeze-hr.vercel.app';
  // Use email as the Composio entity ID - readable in dashboard, no format issues
  const entityId = userEmail || userId.replace(/-/g, '').substring(0, 20);

  try {
    const client = new Composio({ apiKey });

    if (action === 'disconnect') {
      try {
        const entity = client.getEntity(entityId);
        const connections = await entity.getConnections();
        for (const conn of (connections || [])) {
          if ((conn.appName || '').toLowerCase().includes(app)) {
            await conn.delete();
          }
        }
      } catch(e) { /* best effort */ }
      return res.status(200).json({ disconnected: true });
    }

    if (!integrationId) {
      return res.status(400).json({ error: `No Auth Config set up for ${app}. Go to Composio → Auth Configs and create one.` });
    }

    const entity = client.getEntity(entityId);
    const connection = await entity.initiateConnection({
      integrationId,
      redirectUrl: `${origin}?composio_connected=${app}`
    });

    const authUrl = connection.redirectUrl || connection.redirectUri;
    if (!authUrl) {
      return res.status(502).json({ error: 'Composio returned no auth URL', composio_detail: connection });
    }

    return res.status(200).json({ authUrl });
  } catch(e) {
    const msg = e?.message || e?.toString() || 'Unknown error';
    return res.status(500).json({ error: msg, stack: e?.stack?.substring(0, 500) });
  }
}
