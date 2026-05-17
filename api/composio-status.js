const BASE = 'https://backend.composio.dev/api/v3';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(200).json({ gmail: false, outlook: false });

  const user_id = 'user_' + userId.replace(/-/g, '');

  try {
    const r = await fetch(`${BASE}/connected_accounts?user_id=${encodeURIComponent(user_id)}`, {
      headers: { 'x-api-key': apiKey }
    });

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { raw }; }

    if (!r.ok) return res.status(200).json({ gmail: false, outlook: false, debug: data });

    // Return raw data so we can see the actual field names
    const items = data.items || data.connected_accounts || data.connectedAccounts || [];

    const gmail   = items.find(c => {
      const name = (c.toolkit || c.appName || c.app_name || c.appUniqueId || c.app || '').toLowerCase();
      return name.includes('gmail');
    });
    const outlook = items.find(c => {
      const name = (c.toolkit || c.appName || c.app_name || c.appUniqueId || c.app || '').toLowerCase();
      return name.includes('outlook');
    });

    return res.status(200).json({
      gmail:            !!(gmail && (gmail.status === 'ACTIVE' || gmail.isActive || gmail.status === 'active')),
      outlook:          !!(outlook && (outlook.status === 'ACTIVE' || outlook.isActive || outlook.status === 'active')),
      gmailAccountId:   gmail?.id || null,
      outlookAccountId: outlook?.id || null,
      // Debug: show raw so we can see field names
      _raw: items.slice(0, 3)
    });
  } catch(e) {
    return res.status(200).json({ gmail: false, outlook: false, error: e.message });
  }
}
