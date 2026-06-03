import { createClient } from '@supabase/supabase-js';

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return { user: null, error: 'No token' };

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) {
    console.warn('Supabase env vars missing — skipping auth check');
    return { user: { id: 'unknown' }, error: null }; // degrade gracefully
  }

  try {
    const sb = createClient(sbUrl, sbKey);
    const { data: { user }, error } = await sb.auth.getUser(token);
    return { user: user || null, error: error?.message || null };
  } catch(e) {
    console.error('Auth check failed:', e.message);
    return { user: null, error: e.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error: authError } = await verifyAuth(req);
  if (!user) {
    console.error('Unauthorized chat request:', authError);
    return res.status(401).json({ error: 'Unauthorized', detail: authError });
  }

  const { messages, system } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: system,
        messages: messages
      })
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
