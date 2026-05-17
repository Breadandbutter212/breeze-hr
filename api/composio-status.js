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
    try { data = JSON.parse(raw); } catch(e) { data = {}; }

    if (!r.ok) return res.status(200).json({ gmail: false, outlook: false, _debug: data });

    const items = data.items || data.connected_accounts || data.connectedAccounts || [];

    // Use String() to safely convert any field type before .toLowerCase()
    const findApp = (keyword) => items.find(c => {
      // toolkit is an object { slug: "gmail" } in v3 API
      const slug = c.toolkit?.slug || c.toolkit;
      const candidates = [slug, c.appName, c.app_name, c.appUniqueId, c.app];
      return candidates.some(f => f && String(f).toLowerCase().includes(keyword));
    });

    const isActive = (c) => !c || c.status === 'ACTIVE' || c.isActive === true || c.status === 'active';

    const gmail   = findApp('gmail');
    const outlook = findApp('outlook');

    return res.status(200).json({
      gmail:            !!(gmail && isActive(gmail)),
      outlook:          !!(outlook && isActive(outlook)),
      gmailAccountId:   gmail?.id   || null,
      outlookAccountId: outlook?.id || null,
      _raw: items.slice(0, 2)  // debug: remove once working
    });
  } catch(e) {
    return res.status(200).json({ gmail: false, outlook: false, error: e.message });
  }
}
