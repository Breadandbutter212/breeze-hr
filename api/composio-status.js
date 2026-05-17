const BASE = 'https://backend.composio.dev/api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId, userEmail } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(200).json({ gmail: false, outlook: false, connected: [] });

  const entityId = (userEmail || userId).replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    const r = await fetch(`${BASE}/connectedAccounts?entityId=${encodeURIComponent(entityId)}`, {
      headers: { 'x-api-key': apiKey }
    });
    if (!r.ok) return res.status(200).json({ gmail: false, outlook: false, connected: [] });

    const data = await r.json();
    const items = data.items || data.connectedAccounts || [];
    const active = items
      .filter(c => c.status === 'ACTIVE')
      .map(c => (c.appName || '').toLowerCase());

    return res.status(200).json({
      gmail:   active.some(a => a.includes('gmail')),
      outlook: active.some(a => a.includes('outlook')),
      connected: active
    });
  } catch(e) {
    return res.status(200).json({ gmail: false, outlook: false, connected: [] });
  }
}
