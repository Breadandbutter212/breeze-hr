import { Composio } from '@composio/core';

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

  // Composio expects user IDs in user_xxxxx format (alphanumeric only after prefix)
  const raw = (userEmail || userId).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
  const entityId = `user_${raw}`;

  let session;
  try {
    const composio = new Composio({ apiKey });

    // Step 1: create session
    session = await composio.create(entityId);
  } catch(e) {
    return res.status(500).json({ error: e?.message || String(e), step: 'create_session', entityId });
  }

  if (action === 'disconnect') {
    try { await session.disconnectApp?.(app); } catch(e) {}
    return res.status(200).json({ disconnected: true });
  }

  try {
    // Step 2: get Connect Link via manual auth
    const result = await session.authorize(app);

    const authUrl = typeof result === 'string'
      ? result
      : result?.url || result?.connectUrl || result?.authUrl || result?.redirectUrl;

    if (!authUrl) {
      return res.status(502).json({
        error: 'No connect URL returned',
        result: JSON.stringify(result).substring(0, 300)
      });
    }

    return res.status(200).json({ authUrl });
  } catch(e) {
    return res.status(500).json({ error: e?.message || String(e), step: 'authorize', app, entityId });
  }
}
