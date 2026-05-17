export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return res.status(200).json({ gmail: false, outlook: false, error: 'COMPOSIO_API_KEY not set' });

  const entityId = userId.replace(/-/g, '');

  let Composio;
  try {
    ({ Composio } = await import('@composio/core'));
  } catch(e) {
    return res.status(200).json({ gmail: false, outlook: false, importError: e.message });
  }

  try {
    let composio;
    try { composio = new Composio({ apiKey }); }
    catch(e) { composio = new Composio(); }

    const session = await composio.create(entityId);
    const { items } = await session.toolkits({ limit: 50 });

    const find = (slug) => items.find(t => t.slug === slug);
    const gmail   = find('gmail');
    const outlook = find('outlook');

    return res.status(200).json({
      gmail:            gmail?.connection?.isActive   ?? false,
      outlook:          outlook?.connection?.isActive ?? false,
      gmailAccountId:   gmail?.connection?.connectedAccount?.id   || null,
      outlookAccountId: outlook?.connection?.connectedAccount?.id || null,
    });
  } catch(e) {
    return res.status(200).json({ gmail: false, outlook: false, runtimeError: e?.message });
  }
}
