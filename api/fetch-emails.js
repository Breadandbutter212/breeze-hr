import { createClient } from '@supabase/supabase-js';

const BASE = 'https://backend.composio.dev/api/v3';

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

  const { userId, provider = 'gmail' } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  if (userId !== user.id) return res.status(403).json({ error: 'Forbidden' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });

  // v3 uses userId (not entityId), no appName field
  const composioUserId = 'user_' + userId.replace(/-/g, '');
  const action = provider === 'outlook' ? 'MICROSOFT_OUTLOOK_GET_EMAILS' : 'GMAIL_FETCH_EMAILS';

  try {
    const r = await fetch(`${BASE}/actions/${action}/execute`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: composioUserId,
        input: {
          query: 'is:inbox',
          max_results: 20,
          maxResults: 20,
          metadata_headers: ['From', 'Subject', 'Date', 'To'],
          include_headers: true,
          format: 'metadata'
        }
      })
    });
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { raw }; }
    if (!r.ok) return res.status(r.status).json({ error: raw.substring(0, 600), action, userId: composioUserId });
    return res.status(200).json({ data });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
