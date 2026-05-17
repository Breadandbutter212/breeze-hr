import { Composio } from '@composio/core';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(200).json({ gmail: false, outlook: false });

  try {
    const composio = new Composio({ apiKey });
    const entity = await composio.getEntity(userId);
    const connections = await entity.getConnections();
    const active = connections.filter(c => c.status === 'ACTIVE').map(c => c.appName);
    return res.status(200).json({
      gmail: active.includes('gmail'),
      outlook: active.includes('outlook'),
      connected: active
    });
  } catch(e) {
    return res.status(200).json({ gmail: false, outlook: false, connected: [] });
  }
}
