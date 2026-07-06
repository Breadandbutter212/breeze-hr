import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { logAudit, clientIp, ALLOWED_ACTIONS } from './_audit.js';

const BASE_VOYAGE = 'https://api.voyageai.com/v1/embeddings';
const AUDIT_SUPER_ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
  const { data: { user } } = await sb.auth.getUser(token);
  return user || null;
}

async function voyageEmbed(text, inputType = 'document') {
  const key = process.env.VOYAGE_API_KEY;
  if (!key || !text) return null;
  try {
    const r = await fetch(BASE_VOYAGE, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: [text.substring(0, 4000)], model: 'voyage-3-large', input_type: inputType })
    });
    const d = await r.json();
    return d.data?.[0]?.embedding || null;
  } catch(e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);

  // Resolve the caller's company from their profile - never trust a client-supplied companyId (prevents cross-tenant access)
  const { data: prof } = await sb.from('profiles').select('company_id, role').eq('id', user.id).single();
  const companyId = prof?.company_id;

  // ── Audit log (folded in here to stay within the serverless function limit) ──
  // POST {action:'audit-log', event, detail} — record a client-side security event.
  if (req.method === 'POST' && req.body?.action === 'audit-log') {
    const { event, detail } = req.body;
    if (!ALLOWED_ACTIONS.has(event)) return res.status(400).json({ error: 'Unknown action' });
    await logAudit(sb, { company_id: companyId || null, user_id: user.id, user_email: user.email || null, action: event, detail, ip: clientIp(req) });
    return res.status(200).json({ ok: true });
  }
  // GET ?action=audit-list — admins read their own company's recent events.
  if (req.method === 'GET' && req.query.action === 'audit-list') {
    const role = (prof?.role || '').toLowerCase();
    const isAdmin = AUDIT_SUPER_ADMINS.includes((user.email || '').toLowerCase()) || ['owner', 'admin', 'hr_admin'].includes(role);
    if (!isAdmin) return res.status(403).json({ error: 'Admins only' });
    if (!companyId) return res.status(200).json({ events: [] });
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const { data, error } = await sb.from('audit_events')
      .select('id, user_email, action, detail, ip, created_at')
      .eq('company_id', companyId).order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ events: data || [] });
  }

  if (!companyId) return res.status(403).json({ error: 'No company for user' });

  // GET ?action=retrieve&query=... — embed query, return top similar approved responses
  if (req.method === 'GET') {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    const embedding = await voyageEmbed(query, 'query');
    if (!embedding) return res.status(200).json({ examples: [] }); // no Voyage key = graceful degradation

    // pgvector cosine similarity search
    const { data, error } = await sb.rpc('match_hr_responses', {
      query_embedding: embedding,
      company_id_input: companyId,
      match_count: 3
    });
    if (error) return res.status(200).json({ examples: [] });
    return res.status(200).json({ examples: data || [] });
  }

  // POST — analyze ai_draft vs hr_sent, store style signals + embedding
  if (req.method === 'POST') {
    const { responseId, aiDraft, hrSent, query } = req.body;
    if (!responseId || !aiDraft || !hrSent) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Analyze with Sonnet 4.6
    let styleSignals = null;
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const r = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: `Compare an AI-drafted HR message with the final version a human sent.
Report ONLY style/tone/structure edits. IGNORE factual additions (names, dates, policy refs, case facts).
Return ONLY valid JSON - no prose:
{
  "tone_shift": "more_formal|less_formal|more_direct|softer|warmer|cooler|none",
  "lexical_substitutions": [{"from":"...","to":"...","category":"formality|jargon|softening|other"}],
  "structural_changes": [],
  "removed_phrases": [],
  "sign_off": "sign-off used or null"
}`,
        messages: [{ role: 'user', content: `<ai_draft>\n${aiDraft.substring(0,2000)}\n</ai_draft>\n\n<hr_sent>\n${hrSent.substring(0,2000)}\n</hr_sent>` }]
      });
      const raw = r.content[0]?.text || '{}';
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) styleSignals = JSON.parse(match[0]);
    } catch(e) { styleSignals = null; }

    // Embed the query for future RAG retrieval
    const embedding = query ? await voyageEmbed(query, 'document') : null;

    // Update response record
    const updates = {};
    if (styleSignals) updates.style_signals = styleSignals;
    if (query) updates.query = query;
    if (embedding) updates.query_embedding = JSON.stringify(embedding);

    if (Object.keys(updates).length > 0) {
      await sb.from('responses').update(updates).eq('id', responseId).eq('company_id', companyId);
    }

    return res.status(200).json({ ok: true, styleSignals });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
