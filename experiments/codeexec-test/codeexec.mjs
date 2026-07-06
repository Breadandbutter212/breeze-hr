// Code-execution path: ask Claude to BUILD the .docx natively with python-docx inside
// Anthropic's sandbox, then download the generated file(s) via the Files API.
//
// Grounded in the current docs (fetched 2026-07-02):
//   - tool:  { type: "code_execution_20250825", name: "code_execution" }
//   - betas: ["code-execution-2025-08-25", "files-api-2025-04-14"]
//   - generated files: response.content -> code_execution_tool_result block
//       -> .content (bash_code_execution_result) -> .content[] items carry .file_id
//   - download: client.beta.files.download(file_id) -> arrayBuffer()

import fs from 'node:fs/promises';
import path from 'node:path';

export const CODE_EXEC_TOOL = 'code_execution_20250825';
export const BETAS = ['code-execution-2025-08-25', 'files-api-2025-04-14'];
export const MODEL = 'claude-sonnet-4-6';

function systemPrompt(houseStyle) {
  return `You are a document-generation engine for an HR platform. Use the code execution tool to build a polished, professional Microsoft Word (.docx) file with python-docx.

Rules:
- Write and run Python that uses python-docx (pre-installed) to construct the document with real Word styling: styled title, section headings, proper tables (shaded header row, cell borders), spacing, bold/where useful colour.
- Save the file with a clear name ending in .docx in the working directory. Do not print the whole file; just build and save it.
- Produce the finished document only. Do not ask questions.

${houseStyle}`;
}

// Recursively collect file_ids that appear inside code-execution tool-result blocks.
function collectGeneratedFileIds(content) {
  const ids = new Set();
  const walk = (node, insideResult) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, insideResult); return; }
    const type = typeof node.type === 'string' ? node.type : '';
    const nowInside = insideResult || type.includes('code_execution_tool_result') || type.includes('bash_code_execution_result');
    if (nowInside && typeof node.file_id === 'string') ids.add(node.file_id);
    for (const [k, v] of Object.entries(node)) {
      if (k === 'type') continue;
      if (v && typeof v === 'object') walk(v, nowInside);
    }
  };
  walk(content, false);
  return [...ids];
}

async function downloadToBuffer(client, fileId) {
  const resp = await client.beta.files.download(fileId, { betas: ['files-api-2025-04-14'] });
  if (resp && typeof resp.arrayBuffer === 'function') return Buffer.from(await resp.arrayBuffer());
  if (resp && typeof resp.blob === 'function') return Buffer.from(await (await resp.blob()).arrayBuffer());
  if (resp && resp.body) { // stream fallback
    const chunks = [];
    for await (const c of resp.body) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  }
  throw new Error('Unrecognised download response shape');
}

// Run one code-execution generation for a case. Returns {files:[{path,bytes}], usage, ms, stopReason, error}.
export async function runCodeExec(client, testCase, { houseStyle, outDir, maxTokens = 8000 }) {
  const started = Date.now();
  const messages = [{ role: 'user', content: testCase.docPrompt }];
  let response;
  const usageTotals = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

  // Server-tool loop: the model may return stop_reason "pause_turn" while the sandbox runs.
  for (let turn = 0; turn < 6; turn++) {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      betas: BETAS,
      system: systemPrompt(houseStyle),
      tools: [{ type: CODE_EXEC_TOOL, name: 'code_execution' }],
      messages,
    });
    const u = response.usage || {};
    for (const k of Object.keys(usageTotals)) usageTotals[k] += (u[k] || 0);

    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content }); // resume; no extra user text
      continue;
    }
    break;
  }

  const fileIds = collectGeneratedFileIds(response.content);
  const files = [];
  for (const id of fileIds) {
    let filename = `${testCase.id}-codeexec.docx`;
    try {
      const meta = await client.beta.files.retrieveMetadata(id, { betas: ['files-api-2025-04-14'] });
      if (meta?.filename) filename = `${testCase.id}-codeexec-${path.basename(meta.filename)}`;
    } catch { /* keep default name */ }
    const buf = await downloadToBuffer(client, id);
    const outPath = path.join(outDir, filename);
    await fs.writeFile(outPath, buf);
    files.push({ path: outPath, bytes: buf.length, fileId: id });
  }

  return {
    files,
    usage: usageTotals,
    ms: Date.now() - started,
    stopReason: response.stop_reason,
    containerId: response.container?.id || null,
  };
}
