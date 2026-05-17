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

  // Safe entity ID - no special chars
  const entityId = (userEmail || userId).replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    const composio = new Composio({ apiKey });

    if (action === 'disconnect') {
      // Create session and attempt to remove the connected account
      try {
        const session = await composio.create(entityId);
        // Best-effort disconnect - ignore errors
        await session.disconnectApp?.(app);
      } catch(e) {}
      return res.status(200).json({ disconnected: true });
    }

    // Create a session for this user (manual authentication flow)
    const session = await composio.create(entityId);

    // session.authorize() generates a Composio Connect Link
    const result = await session.authorize(app);

    // The result could be a string URL or an object with a url property
    const authUrl = typeof result === 'string'
      ? result
      : result?.url || result?.connectUrl || result?.authUrl || result?.redirectUrl;

    if (!authUrl) {
      return res.status(502).json({
        error: 'Composio returned no connect URL',
        result: JSON.stringify(result).substring(0, 300)
      });
    }

    return res.status(200).json({ authUrl });
  } catch(e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
