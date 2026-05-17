const BASE = 'https://backend.composio.dev/api/v3';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, app, action, connectedAccountId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });

  const user_id = 'user_' + userId.replace(/-/g, '');
  const origin = req.headers.origin || 'https://breeze-hr.vercel.app';
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

  try {
    if (action === 'disconnect') {
      // Delete ALL connections for this app/user (handles duplicates from testing)
      const lr = await fetch(`${BASE}/connected_accounts?user_id=${encodeURIComponent(user_id)}`, { headers });
      if (lr.ok) {
        const ld = await lr.json();
        const items = ld.items || ld.connected_accounts || [];
        const toDelete = items.filter(c => {
          const slug = c.toolkit?.slug || String(c.toolkit || '');
          return slug.toLowerCase().includes(app.toLowerCase());
        });
        await Promise.all(toDelete.map(c =>
          fetch(`${BASE}/connected_accounts/${c.id}`, { method: 'DELETE', headers })
        ));
      }
      return res.status(200).json({ disconnected: true });
    }

    if (!app) return res.status(400).json({ error: 'Missing app' });

    // v3 API: POST /api/v3/connected_accounts/link
    const body = {
      auth_config_id: 'ac_c2wnUZ4TgV8S',
      user_id,
      redirect_uri: origin
    };

    const r = await fetch(`${BASE}/connected_accounts/link`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { raw }; }

    if (!r.ok) {
      return res.status(r.status).json({ error: raw.substring(0, 500), sent: body });
    }

    const authUrl = data.redirectUrl || data.redirect_url || data.url || data.connectionUrl;
    if (!authUrl) return res.status(502).json({ error: 'No auth URL in response', data });

    return res.status(200).json({ authUrl });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
