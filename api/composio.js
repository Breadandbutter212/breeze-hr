const BASE = 'https://backend.composio.dev/api/v3';

const AUTH_CONFIGS = {
  gmail:      process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID      || 'ac_c2wnUZ4TgV8S',
  outlook:    process.env.COMPOSIO_OUTLOOK_AUTH_CONFIG_ID    || 'ac_XCYlyd6APE7n',
  sharepoint: process.env.COMPOSIO_SHAREPOINT_AUTH_CONFIG_ID || 'ac_bPiGL8wDFTPw',
};

const APP_SLUG = {
  gmail:      'gmail',
  outlook:    'microsoft-outlook',
  sharepoint: 'share_point',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.COMPOSIO_API_KEY;

  // GET /api/composio?userId=... → status check
  if (req.method === 'GET') {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    if (!apiKey) return res.status(200).json({ gmail: false, outlook: false, sharepoint: false });
    const user_id = 'user_' + userId.replace(/-/g, '');
    try {
      const r = await fetch(`${BASE}/connected_accounts?user_id=${encodeURIComponent(user_id)}`, {
        headers: { 'x-api-key': apiKey }
      });
      const raw = await r.text();
      let data; try { data = JSON.parse(raw); } catch(e) { data = {}; }
      if (!r.ok) return res.status(200).json({ gmail: false, outlook: false, sharepoint: false });
      const items = data.items || data.connected_accounts || data.connectedAccounts || [];
      const findApp = kw => items.find(c => {
        const slug = c.toolkit?.slug || c.toolkit;
        return [slug, c.appName, c.app_name, c.appUniqueId, c.app].some(f => f && String(f).toLowerCase().includes(kw));
      });
      const isActive = c => !c || c.status === 'ACTIVE' || c.isActive === true || c.status === 'active';
      const gmail = findApp('gmail'), outlook = findApp('outlook');
      const sharepoint = findApp('share_point') || findApp('sharepoint');
      return res.status(200).json({
        gmail: !!(gmail && isActive(gmail)), outlook: !!(outlook && isActive(outlook)), sharepoint: !!(sharepoint && isActive(sharepoint)),
        gmailAccountId: gmail?.id || null, outlookAccountId: outlook?.id || null, sharepointAccountId: sharepoint?.id || null,
      });
    } catch(e) { return res.status(200).json({ gmail: false, outlook: false, sharepoint: false, error: e.message }); }
  }

  // POST /api/composio → connect / disconnect
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { userId, app, action } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });
  const user_id = 'user_' + userId.replace(/-/g, '');
  const origin = req.headers.origin || 'https://breeze-hr.vercel.app';
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

  try {
    if (action === 'disconnect') {
      const lr = await fetch(`${BASE}/connected_accounts?user_id=${encodeURIComponent(user_id)}`, { headers });
      if (lr.ok) {
        const ld = await lr.json();
        const items = ld.items || ld.connected_accounts || [];
        const toDelete = items.filter(c => { const slug = c.toolkit?.slug || String(c.toolkit || ''); return slug.toLowerCase().includes(app.toLowerCase()); });
        await Promise.all(toDelete.map(c => fetch(`${BASE}/connected_accounts/${c.id}`, { method: 'DELETE', headers })));
      }
      return res.status(200).json({ disconnected: true });
    }
    if (!app) return res.status(400).json({ error: 'Missing app' });
    let auth_config_id = AUTH_CONFIGS[app];
    if (!auth_config_id) return res.status(400).json({ error: `No auth config found for ${app}.` });
    const r = await fetch(`${BASE}/connected_accounts/link`, {
      method: 'POST', headers, body: JSON.stringify({ auth_config_id, user_id, redirect_uri: origin })
    });
    const raw = await r.text();
    let data; try { data = JSON.parse(raw); } catch(e) { data = { raw }; }
    if (!r.ok) return res.status(r.status).json({ error: raw.substring(0, 500) });
    const authUrl = data.redirectUrl || data.redirect_url || data.url || data.connectionUrl;
    if (!authUrl) return res.status(502).json({ error: 'No auth URL in response', data });
    return res.status(200).json({ authUrl });
  } catch(e) { return res.status(500).json({ error: e.message }); }
}
