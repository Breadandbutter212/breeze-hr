// Orchestrator for the code-execution vs converter experiment.
//
// Usage:
//   node run.mjs offline     # converter side only, from hand-written drafts (NO API key needed)
//   node run.mjs full        # full head-to-head: same model both sides (needs ANTHROPIC_API_KEY)
//   node run.mjs             # defaults to "full"
//
// Budget guardrails (Sonnet 4.6 rates $3/M input, $15/M output):
//   - hard cap on total spend (~$2); aborts before a call that would exceed it
//   - per-request soft cap (~$0.50); warns loudly
//   - client maxRetries=1, and we do NOT loop on errors: first-call failure is diagnosed and we stop.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, HOUSE_STYLE } from './cases.mjs';
import { renderConverterDocx, generateMarkdown } from './converter.mjs';
import { runCodeExec } from './codeexec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'output');

const RATE_IN = 3 / 1_000_000;    // $ per input token (Sonnet 4.6)
const RATE_OUT = 15 / 1_000_000;  // $ per output token
const RATE_CACHE_READ = 0.3 / 1_000_000;
const RATE_CACHE_WRITE = 3.75 / 1_000_000;
const TOTAL_BUDGET = 2.00;
const PER_REQ_WARN = 0.50;

const usd = (n) => `$${n.toFixed(4)}`;
const costOf = (u = {}) =>
  (u.input_tokens || 0) * RATE_IN +
  (u.output_tokens || 0) * RATE_OUT +
  (u.cache_read_input_tokens || 0) * RATE_CACHE_READ +
  (u.cache_creation_input_tokens || 0) * RATE_CACHE_WRITE;

let spent = 0;
const account = (u, label) => {
  const c = costOf(u);
  spent += c;
  if (c > PER_REQ_WARN) console.warn(`  !! ${label} cost ${usd(c)} exceeded per-request soft cap ${usd(PER_REQ_WARN)}`);
  if (spent > TOTAL_BUDGET) throw new Error(`ABORT: total spend ${usd(spent)} exceeded budget ${usd(TOTAL_BUDGET)}`);
  return c;
};

async function makeClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Export it (the app uses the same var) and re-run: ANTHROPIC_API_KEY=sk-ant-... node run.mjs full');
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ maxRetries: 1 });
}

async function main() {
  const mode = (process.argv[2] || 'full').toLowerCase();
  await fs.mkdir(OUT, { recursive: true });
  const results = [];

  if (mode === 'offline') {
    console.log('Mode: OFFLINE (converter only, from hand-written drafts - no API key used)\n');
    for (const c of CASES) {
      const conv = await renderConverterDocx(c, c.offlineDraft, OUT);
      console.log(`  [${c.id}] converter -> ${path.basename(conv.path)} (${conv.bytes} bytes)`);
      results.push({ id: c.id, converter: conv });
    }
    await writeSummary(results, mode);
    return;
  }

  const client = await makeClient();
  console.log('Mode: FULL head-to-head (same model both sides: claude-sonnet-4-6)\n');

  for (const c of CASES) {
    console.log(`\n=== ${c.id} : ${c.title} ===`);
    const row = { id: c.id, title: c.title };

    // --- Code execution path ---
    try {
      const ce = await runCodeExec(client, c, { houseStyle: HOUSE_STYLE, outDir: OUT, maxTokens: 8000 });
      const c$ = account(ce.usage, `${c.id} codeexec`);
      row.codeexec = {
        cost: c$, ms: ce.ms, usage: ce.usage,
        files: ce.files.map(f => ({ name: path.basename(f.path), bytes: f.bytes })),
        stopReason: ce.stopReason, containerId: ce.containerId,
      };
      const names = ce.files.map(f => path.basename(f.path)).join(', ') || '(no file returned)';
      console.log(`  codeexec: ${usd(c$)} | ${(ce.ms / 1000).toFixed(1)}s | in ${ce.usage.input_tokens} out ${ce.usage.output_tokens} | ${names}`);
    } catch (e) {
      row.codeexec = { error: describeError(e) };
      console.error(`  codeexec ERROR: ${row.codeexec.error}`);
      // First-call failure (esp. auth/beta): stop rather than looping/burning tokens.
      if (isFatal(e)) { row.fatal = true; results.push(row); break; }
    }

    // --- Converter path (same model, Markdown -> renderDocx) ---
    try {
      const gen = await generateMarkdown(client, c, {});
      account(gen.usage, `${c.id} converter-md`);
      const conv = await renderConverterDocx(c, gen.markdown, OUT);
      row.converter = { cost: costOf(gen.usage), ms: gen.ms, usage: gen.usage, file: path.basename(conv.path), bytes: conv.bytes };
      console.log(`  converter: ${usd(costOf(gen.usage))} | ${(gen.ms / 1000).toFixed(1)}s | ${path.basename(conv.path)} (${conv.bytes} bytes)`);
    } catch (e) {
      row.converter = { error: describeError(e) };
      console.error(`  converter ERROR: ${row.converter.error}`);
    }

    results.push(row);
    console.log(`  running total: ${usd(spent)} / ${usd(TOTAL_BUDGET)}`);
  }

  await writeSummary(results, mode);
  console.log(`\nTOTAL SPEND: ${usd(spent)}`);
}

function describeError(e) {
  const status = e?.status || e?.statusCode;
  const type = e?.error?.error?.type || e?.error?.type;
  return [status && `HTTP ${status}`, type, e?.message].filter(Boolean).join(' | ');
}
function isFatal(e) {
  const s = e?.status || e?.statusCode;
  return s === 401 || s === 403 || /API_KEY|not set/i.test(e?.message || '');
}

async function writeSummary(results, mode) {
  const outPath = path.join(OUT, '_run-summary.json');
  await fs.writeFile(outPath, JSON.stringify({ mode, spent, results }, null, 2));
  console.log(`\nSummary written: ${path.relative(HERE, outPath)}`);
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exitCode = 1; });
