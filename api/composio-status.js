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

    if (!r.ok) return res.status(200).json({ gmail: false, outlook: false, sharepoint: false, _debug: data });

    const items = data.items || data.connected_accounts || data.connectedAccounts || [];

    const findApp = (keyword) => items.find(c => {
      const slug = c.toolkit?.slug || c.toolkit;
      const candidates = [slug, c.appName, c.app_name, c.appUniqueId, c.app];
      return candidates.some(f => f && String(f).toLowerCase().includes(keyword));
    });

    const isActive = (c) => !c || c.status === 'ACTIVE' || c.isActive === true || c.status === 'active';

    const gmail      = findApp('gmail');
    const outlook    = findApp('outlook');
    const sharepoint = findApp('share_point') || findApp('sharepoint');

    return res.status(200).json({
      gmail:              !!(gmail && isActive(gmail)),
      outlook:            !!(outlook && isActive(outlook)),
      sharepoint:         !!(sharepoint && isActive(sharepoint)),
      gmailAccountId:     gmail?.id      || null,
      outlookAccountId:   outlook?.id    || null,
      sharepointAccountId: sharepoint?.id || null,
    });
  } catch(e) {
    return res.status(200).json({ gmail: false, outlook: false, sharepoint: false, error: e.message });
  }
}
