const COMPOSIO_BASE = 'https://backend.composio.dev/api/v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(200).json({ gmail: false, outlook: false, connected: [] });

  const entityId = userId.replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    const res2 = await fetch(
      `${COMPOSIO_BASE}/connectedAccounts?entityId=${encodeURIComponent(entityId)}&status=ACTIVE`,
      { headers: { 'x-api-key': apiKey } }
    );

    if (!res2.ok) return res.status(200).json({ gmail: false, outlook: false, connected: [] });

    const data = await res2.json();
    const items = data.items || [];
    const active = items.map(c => (c.appName || '').toLowerCase());

    return res.status(200).json({
      gmail: active.includes('gmail'),
      outlook: active.includes('outlook'),
      connected: active
    });
  } catch(e) {
    return res.status(200).json({ gmail: false, outlook: false, connected: [] });
  }
}
