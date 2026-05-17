import { Composio } from '@composio/core';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId, userEmail } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(200).json({ gmail: false, outlook: false, connected: [] });

  const raw = (userEmail || userId).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
  const entityId = `user_${raw}`;

  try {
    const composio = new Composio({ apiKey });
    const session = await composio.create(entityId);

    const connected = [];
    for (const app of ['gmail', 'outlook']) {
      try {
        const isAuth = await session.isAuthorized?.(app);
        if (isAuth) connected.push(app);
      } catch(e) {}
    }

    return res.status(200).json({
      gmail:   connected.includes('gmail'),
      outlook: connected.includes('outlook'),
      connected
    });
  } catch(e) {
    return res.status(200).json({ gmail: false, outlook: false, connected: [] });
  }
}
