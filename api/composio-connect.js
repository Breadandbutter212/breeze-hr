const BASE = 'https://backend.composio.dev/api/v3';

// Known auth config IDs (set env vars to override)
const AUTH_CONFIGS = {
  gmail:   process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID   || 'ac_c2wnUZ4TgV8S',
  outlook: process.env.COMPOSIO_OUTLOOK_AUTH_CONFIG_ID || 'ac_XCYlyd6APE7n',
};

// Fallback: look up auth config from Composio API by toolkit slug
async function lookupAuthConfig(slug, headers) {
  try {
    const r = await fetch(`${BASE}/auth_configs?toolkit_slug=${slug}&limit=10`, { headers });
    if (r.ok) {
      const d = await r.json();
      const items = d.items || d.auth_configs || [];
      if (items.length) return items[0].id;
    }
  } catch(e) {}
  return null;
}

const APP_SLUG = {
  gmail:   'gmail',
  outlook: 'microsoft-outlook',
};

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

    // Resolve auth config ID for this app
    let auth_config_id = AUTH_CONFIGS[app];
    if (!auth_config_id) {
      const slug = APP_SLUG[app] || app;
      auth_config_id = await lookupAuthConfig(slug, headers);
    }
    if (!auth_config_id) {
      return res.status(400).json({
        error: `No auth config found for ${app}. Please create one in the Composio dashboard and set COMPOSIO_OUTLOOK_AUTH_CONFIG_ID.`
      });
    }

    const body = { auth_config_id, user_id, redirect_uri: origin };

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
