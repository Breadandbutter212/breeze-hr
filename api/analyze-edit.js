import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const BASE_VOYAGE = 'https://api.voyageai.com/v1/embeddings';

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

  // GET ?action=retrieve&query=... — embed query, return top similar approved responses
  if (req.method === 'GET') {
    const { query, companyId } = req.query;
    if (!query || !companyId) return res.status(400).json({ error: 'Missing query or companyId' });

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
    const { responseId, aiDraft, hrSent, query, companyId } = req.body;
    if (!responseId || !aiDraft || !hrSent || !companyId) {
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
