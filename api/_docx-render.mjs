// Structured DOCX renderer. Underscore-prefixed so Vercel does not route it.
//
// Replaces the old hand-rolled WordprocessingML string builder. The flow is:
//   1. parseSpec(text)  -> a structured block spec (headings, lists, tables, callouts…)
//   2. renderSpec(spec) -> a real .docx via the `docx` library (proper nested lists,
//      styled tables, callout boxes, cover block — everything the old converter dropped).
//
// The input text is the same canonical format the app already sends to /api/generate-doc:
//   [TABLE]…§CELL§… blocks, markdown `|` tables, #/##/### headings, **bold**, •/- bullets,
//   1. numbered lists (indentation = nesting), > callouts, --- rules.

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType
} from 'docx';

// Usable body width in twips: Letter (12240) minus left+right margins (1440 each).
const PAGE_WIDTH = 9360;
const BULLET_GLYPHS = ['•', '◦', '▪', '·'];

// ── inline runs: **bold** and *italic* ──
function parseRuns(text) {
  const s = String(text == null ? '' : text);
  const runs = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;
  let last = 0, m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    if (m[1] != null) runs.push({ text: m[1], bold: true });
    else runs.push({ text: m[2], italic: true });
    last = re.lastIndex;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs.length ? runs : [{ text: s }];
}

const looksLikeMeta = s =>
  /\|/.test(s) ||
  /^\s*(version|owner|review|date|prepared|author|status|confidential|classification|reference|ref|effective|one-page|prepared by)\b/i.test(s) ||
  /\[year\]/i.test(s);

// Split a markdown pipe-table row into trimmed cells.
const pipeCells = l => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
const isPipeSeparator = cells => cells.length && cells.every(c => /^:?-{2,}:?$/.test(c) || c === '');

// ── PARSE: canonical text -> structured block spec ──
function parseSpec(text) {
  const blocks = [];
  const raw = String(text || '');

  // Pull [TABLE]…[/TABLE] blocks out first, keeping surrounding text in order.
  const segments = [];
  const tableRe = /\[TABLE\]([\s\S]*?)\[\/TABLE\]/g;
  let lastIdx = 0, tm;
  while ((tm = tableRe.exec(raw)) !== null) {
    if (tm.index > lastIdx) segments.push({ type: 'text', content: raw.slice(lastIdx, tm.index) });
    segments.push({ type: 'table', content: tm[1] });
    lastIdx = tm.index + tm[0].length;
  }
  if (lastIdx < raw.length) segments.push({ type: 'text', content: raw.slice(lastIdx) });

  let titleDone = false;
  let expectSubtitle = false;
  const numCounters = [];                 // per-level counters for ordered lists
  const resetNumbering = () => { numCounters.length = 0; };

  const pushTable = (rowsData) => {
    if (!rowsData.length) return;
    const first = rowsData[0];
    const hasHeader = first && first.every(c => (c === c.toUpperCase() && c.replace(/[^A-Za-z]/g, '').length > 1) || /^\*\*.*\*\*$/.test(c.trim()));
    blocks.push({ type: 'table', rows: rowsData.map(r => r.map(c => c.replace(/\*\*/g, '').trim())), hasHeader });
  };

  for (const seg of segments) {
    if (seg.type === 'table') {
      resetNumbering();
      const rows = seg.content.split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => l.split('§CELL§').map(c => c.trim()));
      pushTable(rows);
      continue;
    }

    const lines = seg.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i].replace(/\s+$/, '');
      const trimmed = rawLine.trim();

      if (!trimmed) { blocks.push({ type: 'spacer' }); continue; }

      // Inline markdown pipe table (rows of `| a | b |`)
      if (trimmed.includes('|') && lines[i + 1] && isPipeSeparator(pipeCells(lines[i + 1]))) {
        const rows = [];
        let j = i;
        while (j < lines.length && lines[j].includes('|')) {
          const cells = pipeCells(lines[j]);
          if (!isPipeSeparator(cells)) rows.push(cells);
          j++;
        }
        resetNumbering();
        if (rows.length) blocks.push({ type: 'table', rows: rows.map(r => r.map(c => c.replace(/\*\*/g, '').trim())), hasHeader: true });
        i = j - 1;
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { resetNumbering(); blocks.push({ type: 'rule' }); continue; }

      // Markdown heading (# … ######), tolerate a stray leading letter
      const hMatch = trimmed.match(/^[a-z]?(#{1,6})\s+(.+)$/);
      // A short fully-bold line acts as a heading (e.g. **Strategic priorities**)
      const isAllBold = /^\*\*[^*]+\*\*$/.test(trimmed) && trimmed.replace(/\*\*/g, '').length < 90;

      if (hMatch || isAllBold) {
        resetNumbering();
        const textPlain = (hMatch ? hMatch[2] : trimmed).replace(/\*+/g, '').trim();
        if (!titleDone) { blocks.push({ type: 'title', text: textPlain }); titleDone = true; expectSubtitle = true; }
        else { blocks.push({ type: 'heading', level: hMatch ? Math.min(hMatch[1].length, 3) : 2, text: textPlain }); }
        continue;
      }

      // Metadata strip immediately under the title -> muted subtitle
      if (expectSubtitle) {
        expectSubtitle = false;
        if (looksLikeMeta(trimmed)) { blocks.push({ type: 'subtitle', text: trimmed.replace(/\*\*/g, '') }); continue; }
      }

      // Leading indentation = nesting level (2 spaces per level, cap 3)
      const indent = (rawLine.match(/^\s*/)[0] || '').replace(/\t/g, '  ').length;
      const level = Math.min(Math.floor(indent / 2), 3);

      // Numbered list item
      const numMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
      if (numMatch) {
        numCounters[level] = (numCounters[level] || 0) + 1;
        for (let d = level + 1; d < numCounters.length; d++) numCounters[d] = 0;
        blocks.push({ type: 'listitem', ordered: true, level, index: numCounters[level], runs: parseRuns(numMatch[2]) });
        continue;
      }

      // Bullet list item
      const bulletMatch = trimmed.match(/^[•▪◦·*-]\s+(.+)$/);
      if (bulletMatch) {
        resetNumbering();
        blocks.push({ type: 'listitem', ordered: false, level, runs: parseRuns(bulletMatch[1]) });
        continue;
      }

      // Callout / blockquote
      const quoteMatch = trimmed.match(/^>\s?(.*)$/);
      if (quoteMatch) { resetNumbering(); blocks.push({ type: 'callout', runs: parseRuns(quoteMatch[1]) }); continue; }

      resetNumbering();
      blocks.push({ type: 'para', runs: parseRuns(trimmed) });
    }
  }
  return blocks;
}

// ── RENDER: block spec -> docx elements ──
const sideBorder = (color, size = 4) => ({ style: BorderStyle.SINGLE, size, color });

function orderedMarker(level, n) {
  if (level === 1) { // a, b, c…
    let s = ''; let x = n;
    while (x > 0) { x--; s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26); }
    return s + '.';
  }
  if (level === 2) { // lowercase roman
    const map = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let x = n, s = '';
    for (const [v, r] of map) while (x >= v) { s += r; x -= v; }
    return s + '.';
  }
  return n + '.';
}

function listParagraph(b, theme) {
  const left = 360 * (b.level + 1);
  const marker = b.ordered ? orderedMarker(b.level, b.index) + ' ' : BULLET_GLYPHS[b.level] + '  ';
  const runs = [
    new TextRun({ text: marker, bold: b.ordered, color: b.ordered ? theme.accent : '000000' }),
    ...b.runs.map(r => new TextRun({ text: r.text, bold: r.bold, italics: r.italic })),
  ];
  return new Paragraph({
    children: runs,
    spacing: { before: 0, after: 80, line: 264, lineRule: 'auto' },
    indent: { left, hanging: 220 },
  });
}

function tableElement(b, theme) {
  const colCount = Math.max(...b.rows.map(r => r.length));
  const colW = Math.floor(PAGE_WIDTH / colCount);
  const cellBorder = () => ({
    top: sideBorder('CCCCCC', 2), bottom: sideBorder('CCCCCC', 2),
    left: sideBorder('CCCCCC', 2), right: sideBorder('CCCCCC', 2),
  });

  let dataIdx = -1;
  const rows = b.rows.map((cells, rowIdx) => {
    const isHeader = b.hasHeader && rowIdx === 0;
    if (!isHeader) dataIdx++;
    const wide = cells.length === 1 && colCount > 1;
    const zebra = (dataIdx % 2 === 0) ? theme.tint : 'FFFFFF';

    const tcs = cells.map((cell, ci) => {
      const fill = isHeader ? theme.accent : zebra;
      let children;
      if (isHeader) {
        children = parseRuns(cell).map(r => new TextRun({ text: r.text, bold: true, color: 'FFFFFF' }));
      } else if (ci === 0 && colCount > 1) {
        children = parseRuns(cell).map(r => new TextRun({ text: r.text, bold: true, color: theme.accent }));
      } else {
        children = parseRuns(cell).map(r => new TextRun({ text: r.text, bold: r.bold, italics: r.italic }));
      }
      return new TableCell({
        ...(wide ? { columnSpan: colCount } : {}),
        width: { size: wide ? PAGE_WIDTH : colW, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
        borders: cellBorder(),
        margins: { top: 60, bottom: 60, left: 110, right: 110 },
        children: [new Paragraph({ children, spacing: { before: 20, after: 20, line: 252, lineRule: 'auto' } })],
      });
    });
    return new TableRow({ children: tcs, tableHeader: isHeader });
  });

  return new Table({
    width: { size: PAGE_WIDTH, type: WidthType.DXA },
    columnWidths: Array(colCount).fill(colW),
    rows,
  });
}

function renderBlocks(blocks, theme) {
  const out = [];
  const accent = theme.accent, tint = theme.tint;
  let headerRuleDone = false;
  const emitHeaderRule = () => {
    if (headerRuleDone) return;
    headerRuleDone = true;
    out.push(new Paragraph({
      spacing: { before: 40, after: 180 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 4 } },
    }));
  };

  blocks.forEach((b, idx) => {
    switch (b.type) {
      case 'title':
        out.push(new Paragraph({
          spacing: { before: 0, after: 40 },
          children: [new TextRun({ text: b.text, bold: true, color: accent, size: 34 })],
        }));
        break;
      case 'subtitle':
        out.push(new Paragraph({
          spacing: { before: 20, after: 0 },
          children: [new TextRun({ text: b.text, color: '595959', size: 18 })],
        }));
        break;
      case 'heading': {
        // A title always gets the divider rule before the first section that follows it.
        if (!headerRuleDone && out.length) emitHeaderRule();
        if (b.level <= 2) {
          out.push(new Paragraph({
            spacing: { before: 280, after: 80 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: theme.rule || tint, space: 3 } },
            children: [new TextRun({ text: b.text.toUpperCase(), bold: true, color: accent, size: 22 })],
          }));
        } else {
          out.push(new Paragraph({
            spacing: { before: 160, after: 50 },
            children: [new TextRun({ text: b.text, bold: true, color: accent, size: 21 })],
          }));
        }
        break;
      }
      case 'listitem':
        if (!headerRuleDone && out.length) emitHeaderRule();
        out.push(listParagraph(b, theme));
        break;
      case 'callout':
        if (!headerRuleDone && out.length) emitHeaderRule();
        out.push(new Paragraph({
          spacing: { before: 80, after: 120, line: 264, lineRule: 'auto' },
          indent: { left: 240, right: 120 },
          shading: { type: ShadingType.CLEAR, fill: tint, color: 'auto' },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 8 } },
          children: b.runs.map(r => new TextRun({ text: r.text, bold: r.bold, italics: r.italic })),
        }));
        break;
      case 'rule':
        out.push(new Paragraph({
          spacing: { before: 60, after: 60 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D0D0', space: 2 } },
        }));
        break;
      case 'table':
        if (!headerRuleDone && out.length) emitHeaderRule();
        out.push(tableElement(b, theme));
        out.push(new Paragraph({ spacing: { before: 0, after: 160 } }));
        break;
      case 'spacer': {
        // Collapse runs of blank lines; skip leading/trailing.
        const prev = blocks[idx - 1];
        if (prev && prev.type !== 'spacer' && idx > 0) out.push(new Paragraph({ spacing: { before: 0, after: 0 } }));
        break;
      }
      case 'para':
      default:
        if (!headerRuleDone && out.length) emitHeaderRule();
        out.push(new Paragraph({
          spacing: { before: 0, after: 100, line: 264, lineRule: 'auto' },
          children: b.runs.map(r => new TextRun({ text: r.text, bold: r.bold, italics: r.italic })),
        }));
    }
  });
  return out;
}

// Public API — returns a Promise<Buffer> of a .docx.
export async function renderDocx(text, theme = { accent: '1F3864', tint: 'EAF1F8' }) {
  const blocks = parseSpec(text);
  const children = renderBlocks(blocks, theme);
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 20 },
          paragraph: { spacing: { after: 100, line: 264, lineRule: 'auto' } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 },
        },
      },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

export { parseSpec };
