import { createClient } from '@supabase/supabase-js';

const BASE_V2 = 'https://backend.composio.dev/api/v2';

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
  const { data: { user } } = await sb.auth.getUser(token);
  return user || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, query } = req.body;
  if (!userId || !query) return res.status(400).json({ error: 'Missing userId or query' });
  if (userId !== user.id) return res.status(403).json({ error: 'Forbidden' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });

  const entityId = 'user_' + userId.replace(/-/g, '');

  try {
    const r = await fetch(`${BASE_V2}/actions/SHARE_POINT_SEARCH_QUERY/execute`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId,
        appName: 'sharepoint',
        input: {
          query_text: query,
          row_limit: 10,
          select_properties: ['Title', 'Path', 'Author', 'LastModifiedTime', 'FileExtension', 'HitHighlightedSummary', 'SPSiteURL', 'ParentLink']
        }
      })
    });

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { raw }; }
    if (!r.ok) return res.status(r.status).json({ error: raw.substring(0, 600) });
    return res.status(200).json({ data });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
