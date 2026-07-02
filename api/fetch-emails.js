import { createClient } from '@supabase/supabase-js';

const BASE = 'https://backend.composio.dev/api/v3.1';

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

  const { userId, provider = 'gmail', action } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  if (userId !== user.id) return res.status(403).json({ error: 'Forbidden' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });

  const user_id = 'user_' + userId.replace(/-/g, '');

  // Contact search action
  if (action === 'contacts') {
    const { query: contactQuery = '' } = req.body;
    try {
      const r = await fetch(`${BASE}/tools/execute/GMAIL_GET_CONTACTS`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id, arguments: { query: contactQuery, max_results: 10 } })
      });
      const raw = await r.text();
      let data;
      try { data = JSON.parse(raw); } catch(e) { data = { raw }; }
      if (!r.ok) return res.status(200).json({ contacts: [] });
      return res.status(200).json({ data });
    } catch(e) {
      return res.status(200).json({ contacts: [] });
    }
  }

  const toolSlug = provider === 'outlook' ? 'OUTLOOK_LIST_MESSAGES' : 'GMAIL_FETCH_EMAILS';
  const toolArgs = provider === 'outlook'
    ? { folder_id: 'inbox', top: 20, ...(req.body.pageToken ? { skip: req.body.pageToken } : {}) }
    : { query: 'is:inbox', max_results: 20, ...(req.body.pageToken ? { page_token: req.body.pageToken } : {}) };

  try {
    const r = await fetch(`${BASE}/tools/execute/${toolSlug}`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id, arguments: toolArgs })
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
