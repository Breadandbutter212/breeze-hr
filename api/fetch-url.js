import { createClient } from '@supabase/supabase-js';
import { URL } from 'url';
import dns from 'dns/promises';

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
  const { data: { user } } = await sb.auth.getUser(token);
  return user || null;
}

function isPrivateIp(ip) {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|169\.254\.|::1|fc|fd)/i.test(ip);
}

async function isSafeUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const hostname = parsed.hostname;
  // Block obvious private hostnames
  if (/^(localhost|metadata\.google\.internal)$/i.test(hostname)) return false;
  // Resolve DNS and check resolved IPs
  try {
    const addrs = await dns.resolve4(hostname).catch(() => []);
    const addrs6 = await dns.resolve6(hostname).catch(() => []);
    for (const ip of [...addrs, ...addrs6]) {
      if (isPrivateIp(ip)) return false;
    }
  } catch { return false; }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  if (!(await isSafeUrl(url))) {
    return res.status(400).json({ error: 'URL not allowed' });
  }

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BreezeHR/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    });

    if (!r.ok) return res.status(200).json({ error: `Page returned ${r.status}`, text: '' });

    // Cap response size at 2MB before parsing
    const reader = r.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 2 * 1024 * 1024) break;
      chunks.push(value);
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
      .replace(/\s{3,}/g, '\n\n')
      .trim();

    return res.status(200).json({ text: text.substring(0, 15000) });
  } catch(e) {
    return res.status(200).json({ error: e.message, text: '' });
  }
}
