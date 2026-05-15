export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { search } = req.query;

  const rawKey = process.env.MERGE_API_KEY || '';
  const accountToken = process.env.MERGE_ACCOUNT_TOKEN || '';
  const apiKey = rawKey.replace(/^Bearer\s+/i, '').trim();

  if (!apiKey || !accountToken) {
    return res.status(500).json({ error: 'Merge credentials not configured in environment variables' });
  }

  try {
    const response = await fetch(`https://api.merge.dev/api/hris/v1/employees?page_size=100&expand=employments,company`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-Account-Token': accountToken
      }
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch(e) {
      return res.status(502).json({ error: 'Non-JSON from Merge', httpStatus: response.status, raw: text.substring(0, 500), keyLength: apiKey.length, keyStart: apiKey.substring(0,8) });
    }
    return res.status(response.status).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
