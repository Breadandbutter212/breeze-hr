import { createClient } from '@supabase/supabase-js';

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
  const { data: { user } } = await sb.auth.getUser(token);
  return user || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const rawKey = process.env.MERGE_API_KEY || '';
  const accountToken = process.env.MERGE_ACCOUNT_TOKEN || '';
  const apiKey = rawKey.replace(/^Bearer\s+/i, '').trim();

  if (!apiKey || !accountToken) {
    return res.status(500).json({ error: 'Merge credentials not configured in environment variables' });
  }

  try {
    let allEmployees = [];
    let cursor = null;

    while (true) {
      const base = `https://api.merge.dev/api/hris/v1/employees?page_size=100&expand=employments,company`;
      const url = cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-Account-Token': accountToken
        }
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch(e) {
        return res.status(502).json({ error: 'Non-JSON from Merge', raw: text.substring(0, 300) });
      }
      if (!response.ok) return res.status(response.status).json(data);
      allEmployees = allEmployees.concat(data.results || []);
      cursor = data.next || null;
      if (!cursor) break;
    }

    return res.status(200).json({ results: allEmployees });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
