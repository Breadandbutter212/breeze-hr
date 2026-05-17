import { Composio } from '@composio/core';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.query.userId;
  const userEmail = req.query.userEmail;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(200).json({ gmail: false, outlook: false, connected: [] });

  const entityId = userEmail || userId.replace(/-/g, '').substring(0, 20);

  try {
    const client = new Composio({ apiKey });
    const entity = client.getEntity(entityId);
    const connections = await entity.getConnections();
    const active = (connections || [])
      .filter(c => c.status === 'ACTIVE')
      .map(c => (c.appName || '').toLowerCase());

    return res.status(200).json({
      gmail: active.some(a => a.includes('gmail')),
      outlook: active.some(a => a.includes('outlook')),
      connected: active
    });
  } catch(e) {
    return res.status(200).json({ gmail: false, outlook: false, connected: [] });
  }
}
