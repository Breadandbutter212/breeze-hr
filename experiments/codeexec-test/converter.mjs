// Converter path: this is what the Breeze app does TODAY.
//
// The app's doc generation is api/generate-doc.js, whose plainText path now calls renderDocx
// from api/_docx-render.mjs (this replaced the old hand-rolled textToDocxBuffer). We import that
// SAME function read-only so the comparison reflects the real current app output. In the app the
// model returns Markdown-ish text and renderDocx turns it into a .docx.
//
//   full mode:    same model + same docPrompt, but ask for Markdown only, then renderDocx it.
//   offline mode: renderDocx a representative hand-written draft (no API key needed).

import fs from 'node:fs/promises';
import path from 'node:path';
import { renderDocx } from '../../api/_docx-render.mjs';

const THEME = { navy: { accent: '1F3864', tint: 'EAF1F8' } };

export async function renderConverterDocx(testCase, markdown, outDir) {
  const theme = THEME[testCase.accent] || THEME.navy;
  const buf = await renderDocx(markdown, theme);
  const outPath = path.join(outDir, `${testCase.id}-converter.docx`);
  await fs.writeFile(outPath, buf);
  return { path: outPath, bytes: buf.length };
}

// Ask the model for the same content as Markdown only (the app's real input to the converter).
export async function generateMarkdown(client, testCase, { model = 'claude-sonnet-4-6', maxTokens = 4000 }) {
  const started = Date.now();
  const system =
`You produce the body of an HR document as clean Markdown ONLY - no commentary, no code fences.
Use: # / ## / ### headings, **bold**, - bullets, 1. numbered lists, > for a callout, and Markdown pipe tables (| a | b |). UK English, no em dashes, no emoji.`;
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: testCase.docPrompt }],
  });
  const markdown = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { markdown, usage: response.usage || {}, ms: Date.now() - started };
}
