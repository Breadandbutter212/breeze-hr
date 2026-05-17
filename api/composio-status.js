const BASE = 'https://backend.composio.dev/api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(200).json({ gmail: false, outlook: false });

  const entityId = 'user_' + userId.replace(/-/g, '');

  try {
    const r = await fetch(`${BASE}/connectedAccounts?entityId=${encodeURIComponent(entityId)}`, {
      headers: { 'x-api-key': apiKey }
    });
    if (!r.ok) return res.status(200).json({ gmail: false, outlook: false });

    const data = await r.json();
    const items = data.items || data.connectedAccounts || [];
    const active = items.filter(c => c.status === 'ACTIVE');

    const gmail   = active.find(c => (c.appName || '').toLowerCase().includes('gmail'));
    const outlook = active.find(c => (c.appName || '').toLowerCase().includes('outlook'));

    return res.status(200).json({
      gmail:            !!gmail,
      outlook:          !!outlook,
      gmailAccountId:   gmail?.id   || null,
      outlookAccountId: outlook?.id || null,
    });
  } catch(e) {
    return res.status(200).json({ gmail: false, outlook: false });
  }
}
