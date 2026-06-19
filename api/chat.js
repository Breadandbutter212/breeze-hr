import { createClient } from '@supabase/supabase-js';

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return { user: null, error: 'No token' };

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) {
    // Fail closed: never authenticate a request when we cannot verify the token
    console.error('Supabase env vars missing — refusing request');
    return { user: null, error: 'Auth unavailable' };
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

  const { messages, system, max_tokens, model } = req.body;

  // Allow callers to request a larger budget (e.g. document mode), capped server-side.
  // Document generation can run long, so the ceiling is 16k - quick chat still defaults to 2048.
  const reqTokens = Number(max_tokens);
  const safeTokens = Number.isFinite(reqTokens) ? Math.min(Math.max(reqTokens, 256), 16000) : 2048;

  // Whitelist the model. Quick chat stays on Sonnet (cheap); document mode may opt into Opus.
  const MODELS = { 'claude-sonnet-4-6': 1, 'claude-opus-4-8': 1 };
  const safeModel = MODELS[model] ? model : 'claude-sonnet-4-6';

  // Stream large generations so the long Opus document response keeps the connection alive
  // (avoids Anthropic's non-streaming long-request limit). We reassemble the full text
  // server-side and return the same JSON shape the client already expects.
  const useStream = safeTokens > 8192;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: safeModel,
        max_tokens: safeTokens,
        system: system,
        messages: messages,
        ...(useStream ? { stream: true } : {})
      })
    });

    if (!useStream) {
      const data = await response.json();
      return res.status(response.ok ? 200 : response.status).json(data);
    }

    // Accumulate the SSE stream into one text block.
    if (!response.ok || !response.body) {
      const errData = await response.json().catch(() => ({ error: 'Upstream error' }));
      return res.status(response.status || 500).json(errData);
    }
    let text = '', stopReason = null, usage = null, buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep the partial last line for the next chunk
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let evt; try { evt = JSON.parse(payload); } catch { continue; }
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') text += evt.delta.text;
        else if (evt.type === 'message_delta') { if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason; if (evt.usage) usage = evt.usage; }
        else if (evt.type === 'error') return res.status(500).json({ error: evt.error?.message || 'Stream error' });
      }
    }
    return res.status(200).json({
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
      model: safeModel,
      usage
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
