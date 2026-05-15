export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { search } = req.query;
  if (!search) return res.status(400).json({ error: 'search query required' });

  try {
    const response = await fetch(`https://api.merge.dev/api/hris/v1/employees?search=${encodeURIComponent(search)}`, {
      headers: {
        'Authorization': `Bearer ${process.env.MERGE_API_KEY}`,
        'X-Account-Token': process.env.MERGE_ACCOUNT_TOKEN
      }
    });
    const data = await response.json();
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: 'Failed to reach Merge API' });
  }
}
