// Premium .docx via Anthropic's code execution tool: Claude builds the Word file natively with
// python-docx in a sandbox, for higher-quality formatting than our Markdown->docx converter.
// Underscore-prefixed so Vercel does not route it. Raw fetch (no SDK dependency, so chat.js's
// pinned SDK is untouched). Grounded in the live docs (2026-07-02).

const API = 'https://api.anthropic.com/v1';
const MODEL = 'claude-sonnet-4-6';
const TOOL = 'code_execution_20250825';
const BETA = 'code-execution-2025-08-25,files-api-2025-04-14';
const MAX_TOKENS = 8000;
const MAX_TURNS = 6;              // server-tool (pause_turn) continuations - bounds per-request cost
// Internal deadline: abort and fall back to the converter with headroom before the function's
// 300s Vercel cap, so we never return a raw 504 with no document.
const DEADLINE_MS = 260000;

// Best-effort cumulative spend guard (per warm serverless instance, like chat.js's rate limiter).
let _spend = 0;
const SPEND_CEILING = 2.00;
const costOf = (u = {}) =>
  ((u.input_tokens || 0) * 3 + (u.output_tokens || 0) * 15 +
   (u.cache_read_input_tokens || 0) * 0.3 + (u.cache_creation_input_tokens || 0) * 3.75) / 1e6;

export function premiumSpend() { return _spend; }

function systemPrompt() {
  return `You are a document-generation engine for an HR platform. Use the code execution tool to build ONE polished Microsoft Word (.docx) file with python-docx (pre-installed), then save it.

Rules:
- Work in ONE step: write the complete python-docx script and run it once, then stop. Do not explain, do not narrate, do not iterate or verify - speed matters.
- Real Word styling: a styled title, section headings, proper tables (shaded header row with white bold text, light zebra striping on data rows, thin grey cell borders), sensible spacing, bold where useful.
- Faithfully include all the content given. Do not invent facts. Do not ask questions.
- Save the finished file with a name ending in .docx in the working directory.

Breeze HR house style: clean, professional "top HR consultancy" look; navy (#1F3864) headings/accents on white; Arial/Helvetica ~10-11pt body; clear hierarchy and generous spacing; never use em dashes (use a single hyphen); no emoji; UK English.`;
}

// Recursively collect file_ids that appear inside code-execution tool-result blocks.
function collectFileIds(content) {
  const ids = new Set();
  const walk = (node, inside) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, inside); return; }
    const type = typeof node.type === 'string' ? node.type : '';
    const nowInside = inside || type.includes('code_execution_tool_result') || type.includes('bash_code_execution_result');
    if (nowInside && typeof node.file_id === 'string') ids.add(node.file_id);
    for (const [k, v] of Object.entries(node)) {
      if (k !== 'type' && v && typeof v === 'object') walk(v, nowInside);
    }
  };
  walk(content, false);
  return [...ids];
}

async function fileMeta(key, id) {
  try {
    const r = await fetch(`${API}/files/${id}`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'files-api-2025-04-14' },
    });
    if (r.ok) return await r.json();
  } catch { /* ignore */ }
  return null;
}

// Returns a Buffer of the generated .docx, or throws (caller falls back to the standard converter).
export async function generatePremiumDocx(sourceText, accent) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  if (_spend > SPEND_CEILING) throw new Error(`premium spend ceiling reached ($${_spend.toFixed(2)})`);

  const headers = {
    'x-api-key': key, 'anthropic-version': '2023-06-01',
    'anthropic-beta': BETA, 'content-type': 'application/json',
  };
  const messages = [{
    role: 'user',
    content: `Accent colour: ${accent || 'navy'} (navy = #1F3864). Build a polished .docx from the following document content:\n\n${sourceText}`,
  }];

  const start = Date.now();
  const withDeadline = async (fn) => {
    const remaining = DEADLINE_MS - (Date.now() - start);
    if (remaining <= 0) throw new Error(`timed out after ${Math.round((Date.now() - start) / 1000)}s`);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), remaining);
    try { return await fn(ctrl.signal); }
    finally { clearTimeout(t); }
  };

  let data;
  let callCost = 0;   // cost of THIS document build (across its turns)
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const r = await withDeadline((signal) => fetch(`${API}/messages`, {
      method: 'POST', headers, signal,
      body: JSON.stringify({
        model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt(),
        tools: [{ type: TOOL, name: 'code_execution' }], messages,
      }),
    }));
    const txt = await r.text();
    if (!r.ok) throw new Error(`messages ${r.status}: ${txt.slice(0, 180)}`);
    data = JSON.parse(txt);
    const c = costOf(data.usage);
    _spend += c; callCost += c;
    if (data.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: data.content }); continue; }
    break;
  }

  const ids = collectFileIds(data.content);
  if (!ids.length) throw new Error('code execution produced no file');

  // Prefer a .docx output; else take the last created file.
  let chosen = null;
  for (const id of ids) {
    const meta = await fileMeta(key, id);
    if (meta?.filename && /\.docx$/i.test(meta.filename)) { chosen = id; break; }
  }
  if (!chosen) chosen = ids[ids.length - 1];

  const dl = await fetch(`${API}/files/${chosen}/content`, {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'files-api-2025-04-14' },
  });
  if (!dl.ok) throw new Error(`download ${dl.status}`);
  return { buffer: Buffer.from(await dl.arrayBuffer()), cost: callCost };
}
