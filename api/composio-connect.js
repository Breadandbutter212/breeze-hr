import { Composio } from '@composio/core';

// Reads COMPOSIO_API_KEY from env automatically — do NOT pass apiKey to constructor
const composio = new Composio();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, app, action, connectedAccountId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  // Use clean UUID (no hyphens) as the Composio entity ID
  const entityId = userId.replace(/-/g, '');
  const origin = req.headers.origin || 'https://breeze-hr.vercel.app';

  try {
    if (action === 'disconnect') {
      if (connectedAccountId) {
        await composio.connectedAccounts.delete(connectedAccountId);
      }
      return res.status(200).json({ disconnected: true });
    }

    if (!app) return res.status(400).json({ error: 'Missing app' });

    const session = await composio.create(entityId);

    const connectionRequest = await session.authorize(app, {
      callbackUrl: origin
    });

    const authUrl = connectionRequest.redirectUrl;
    if (!authUrl) return res.status(502).json({ error: 'No redirect URL returned', detail: connectionRequest });

    return res.status(200).json({ authUrl });
  } catch(e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
