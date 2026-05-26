import { createClient } from '@supabase/supabase-js';

const BASE_V2 = 'https://backend.composio.dev/api/v3';

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
  const { data: { user } } = await sb.auth.getUser(token);
  return user || null;
}

function extractTextFromDocx(base64) {
  try {
    const buf = Buffer.from(base64, 'base64');
    const str = buf.toString('latin1');
    const xmlStart = str.indexOf('<?xml');
    if (xmlStart === -1) return null;
    const text = str
      .replace(/<w:t[^>]*>([^<]+)<\/w:t>/g, ' $1 ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{3,}/g, '\n\n')
      .trim();
    return text.substring(0, 6000) || null;
  } catch(e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, query, action, filePath, siteUrl } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  if (userId !== user.id) return res.status(403).json({ error: 'Forbidden' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'COMPOSIO_API_KEY not set' });

  const entityId = 'user_' + userId.replace(/-/g, '');

  // action=fetch: download full file content from SharePoint
  if (action === 'fetch' && filePath) {
    try {
      // Try Composio's file download action with the file URL/path
      const r = await fetch(`${BASE_V2}/actions/SHARE_POINT_GET_FILE_CONTENT/execute`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId,
          appName: 'sharepoint',
          input: { file_url: filePath, site_url: siteUrl || '' }
        })
      });
      if (!r.ok) throw new Error(`Composio returned ${r.status}`);
      const data = await r.json();

      // Try to extract text from response - Composio may return base64 content or raw text
      const content = data?.data?.content || data?.data?.file_content || data?.data?.text || data?.response_data?.content || '';
      if (!content) return res.status(200).json({ text: null });

      // If it looks like base64 encoded docx, extract text from XML
      let text = content;
      if (/^[A-Za-z0-9+/]{100,}={0,2}$/.test(content.substring(0, 200))) {
        text = extractTextFromDocx(content) || content.substring(0, 6000);
      } else {
        text = String(content).substring(0, 6000);
      }

      return res.status(200).json({ text });
    } catch(e) {
      return res.status(200).json({ text: null, error: e.message });
    }
  }

  // Default: search
  if (!query) return res.status(400).json({ error: 'Missing query' });

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
