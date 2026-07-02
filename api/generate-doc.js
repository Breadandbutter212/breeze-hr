import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { createClient } from '@supabase/supabase-js';

const enc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ── DOCUMENT THEME ──
// Resolve a requested accent (a colour name or #hex) into a dark accent + a light tint
// for zebra rows / rules. Defaults to navy. Lets a doc be produced "in orange", "in green", etc.
const THEME_PALETTE = {
  navy:    { accent: '1F3864', tint: 'EAF1F8' },
  blue:    { accent: '1D4ED8', tint: 'E6EEFF' },
  teal:    { accent: '0F766E', tint: 'E1F4F1' },
  green:   { accent: '15803D', tint: 'E7F6EC' },
  emerald: { accent: '047857', tint: 'E3F5EE' },
  orange:  { accent: 'C2410C', tint: 'FCEDE2' },
  amber:   { accent: 'B45309', tint: 'FDF1DD' },
  gold:    { accent: '92400E', tint: 'FBEFD9' },
  red:     { accent: 'B91C1C', tint: 'FCEAEA' },
  burgundy:{ accent: '7F1D1D', tint: 'F6E7E7' },
  maroon:  { accent: '7F1D1D', tint: 'F6E7E7' },
  purple:  { accent: '6D28D9', tint: 'F1EAFC' },
  violet:  { accent: '6D28D9', tint: 'F1EAFC' },
  pink:    { accent: 'BE185D', tint: 'FBE7F0' },
  magenta: { accent: 'BE185D', tint: 'FBE7F0' },
  charcoal:{ accent: '374151', tint: 'EEF1F4' },
  grey:    { accent: '374151', tint: 'EEF1F4' },
  gray:    { accent: '374151', tint: 'EEF1F4' },
  black:   { accent: '1F2937', tint: 'EEF1F4' },
  slate:   { accent: '334155', tint: 'EDF1F6' }
};
function lightenHex(hex, amt = 0.88) {
  const h = String(hex||'').replace('#','');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 'EAF1F8';
  const mix = (c) => Math.round(c + (255 - c) * amt).toString(16).padStart(2, '0');
  return (mix(parseInt(h.slice(0,2),16)) + mix(parseInt(h.slice(2,4),16)) + mix(parseInt(h.slice(4,6),16))).toUpperCase();
}
function resolveTheme(accentReq) {
  if (!accentReq) return { ...THEME_PALETTE.navy };
  const raw = String(accentReq).trim().toLowerCase();
  // direct colour-name match (also catches "burnt orange", "dark green" -> first known word)
  for (const name of Object.keys(THEME_PALETTE)) {
    if (raw === name || raw.includes(name)) return { ...THEME_PALETTE[name] };
  }
  // hex value (#RRGGBB or RRGGBB)
  const hx = raw.replace('#','');
  if (/^[0-9a-f]{6}$/.test(hx)) return { accent: hx.toUpperCase(), tint: lightenHex(hx) };
  return { ...THEME_PALETTE.navy };
}

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
    const { data: { user } } = await sb.auth.getUser(token);
    return user || null;
  } catch(e) { return null; }
}

function parseInlineRuns(line) {
  const parts = line.split(/\*\*(.*?)\*\*/g);
  return parts.map((text, i) => ({ text, bold: i % 2 === 1 })).filter(r => r.text);
}

function runsToXml(runs) {
  return runs.map(r => {
    const rPr = r.bold ? '<w:rPr><w:b/></w:rPr>' : '';
    return `<w:r>${rPr}<w:t xml:space="preserve">${enc(r.text)}</w:t></w:r>`;
  }).join('');
}

// Generate Word XML paragraphs for a table cell (handles multiline / bullets)
function cellParasXml(cellText) {
  if (!cellText.trim()) return `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr></w:p>`;
  const lines = cellText.split('\n');
  return lines.map(line => {
    const t = line.trim();
    if (!t) return `<w:p><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr></w:p>`;
    const isBullet = t.startsWith('•') || t.startsWith('-');
    const indent = isBullet ? '<w:ind w:left="240"/>' : '';
    const runs = parseInlineRuns(t);
    return `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${indent}</w:pPr>${runsToXml(runs)}</w:p>`;
  }).join('');
}

// Generate Word XML for a table from marker format
// rowsData: array of arrays of cell strings (already has **bold** markers, \n for line breaks)
function tableToXml(rowsData, theme = { accent: '1F3864', tint: 'EAF1F8' }) {
  if (!rowsData.length) return '';
  const bdr = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/>`;
  const tblBorders = `<w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(bdr).join('')}</w:tblBorders>`;

  // Check if first row looks like a header (all-caps or bold markers)
  const firstRow = rowsData[0];
  const isHeader = (cell) => cell === cell.toUpperCase() && cell.length > 2;
  const hasHeaderRow = firstRow && firstRow.every(c => isHeader(c) || c.startsWith('**'));

  const rowXml = rowsData.map((cells, rowIdx) => {
    const isHdrRow = hasHeaderRow && rowIdx === 0;
    // colspan row: only one cell but it spans all columns
    const isWide = cells.length === 1 && rowsData.some(r => r.length > 1);
    const colCount = Math.max(...rowsData.map(r => r.length));
    const colW = isWide ? 9360 : Math.floor(9360 / (cells.length || 1));

    // Full-row zebra striping (light tint / white) under an accent header, matching a designed one-pager.
    const dataIdx = hasHeaderRow ? rowIdx - 1 : rowIdx;
    const zebra = (dataIdx % 2 === 0) ? theme.tint : 'FFFFFF';
    const tcXml = cells.map((cell, ci) => {
      const fill = isHdrRow ? theme.accent : zebra;
      const bdrXml = `<w:tcBorders>${['top','left','bottom','right'].map(s=>`<w:${s} w:val="single" w:sz="2" w:space="0" w:color="CCCCCC"/>`).join('')}</w:tcBorders>`;
      const spanAttr = isWide ? `<w:gridSpan w:val="${colCount}"/>` : '';
      const tcW = isWide ? 9360 : colW;
      const cellPr = `<w:tcPr><w:tcW w:w="${tcW}" w:type="dxa"/>${spanAttr}<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>${bdrXml}<w:vAlign w:val="center"/></w:tcPr>`;

      let parasXml;
      if (isHdrRow) {
        // Bold white text in header
        const runs = parseInlineRuns(cell);
        parasXml = `<w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>${runs.map(r=>`<w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${enc(r.text)}</w:t></w:r>`).join('')}</w:p>`;
      } else if (ci === 0 && cells.length > 1) {
        // First column reads as a row label: bold accent colour
        const runs = parseInlineRuns(cell);
        parasXml = `<w:p><w:pPr><w:spacing w:before="50" w:after="50"/></w:pPr>${runs.map(r=>`<w:r><w:rPr><w:b/><w:color w:val="${theme.accent}"/></w:rPr><w:t xml:space="preserve">${enc(r.text)}</w:t></w:r>`).join('')}</w:p>`;
      } else {
        parasXml = cellParasXml(cell);
      }
      return `<w:tc>${cellPr}${parasXml}</w:tc>`;
    }).join('');
    return `<w:tr>${tcXml}</w:tr>`;
  }).join('');

  const colCount = Math.max(...rowsData.map(r => r.length));
  const colW = Math.floor(9360 / colCount);
  const gridCols = Array(colCount).fill(`<w:gridCol w:w="${colW}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/>${tblBorders}<w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${rowXml}</w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="160"/></w:pPr></w:p>`;
}

function textToDocxBuffer(text, theme = { accent: '1F3864', tint: 'EAF1F8' }) {
  // Segment into text and [TABLE] blocks
  const segments = [];
  let remaining = text || '';
  const tableRe = /\[TABLE\]([\s\S]*?)\[\/TABLE\]/g;
  let lastIdx = 0, m;
  while ((m = tableRe.exec(remaining)) !== null) {
    if (m.index > lastIdx) segments.push({type:'text', content: remaining.slice(lastIdx, m.index)});
    segments.push({type:'table', content: m[1]});
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < remaining.length) segments.push({type:'text', content: remaining.slice(lastIdx)});

  let paras = '';
  // Document accent colour (from the requested theme) and a muted tone for metadata.
  const NAVY = theme.accent || '1F3864', MUTED = '595959', TINT_RULE = lightenHex(NAVY, 0.7);
  let titleDone = false;       // the first heading becomes the document Title
  let expectSubtitle = false;  // a metadata strip directly under the title renders muted
  let pendingHeaderRule = false; // emit a divider rule under the whole title/subtitle block, once

  // Flush a thin horizontal divider under the header block (between the title area and the body).
  const headerRule = () => `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${NAVY}"/></w:pBdr><w:spacing w:before="40" w:after="180"/></w:pPr></w:p>`;

  // Styled heading. level 0 = Title; 1-2 = section heading (CAPS, navy, underlined); 3+ = subheading.
  const headingXml = (textPlain, level) => {
    const t = enc(textPlain.trim());
    if (level === 0) {
      return `<w:p><w:pPr><w:spacing w:before="0" w:after="40"/></w:pPr>`
        + `<w:r><w:rPr><w:b/><w:color w:val="${NAVY}"/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    }
    if (level <= 2) {
      // Section heading: navy, all-caps, with a rule underneath
      return `<w:p><w:pPr><w:spacing w:before="280" w:after="80"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="3" w:color="${TINT_RULE}"/></w:pBdr></w:pPr>`
        + `<w:r><w:rPr><w:b/><w:caps/><w:color w:val="${NAVY}"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    }
    // Subheading: navy, mixed case, no rule
    return `<w:p><w:pPr><w:spacing w:before="160" w:after="50"/></w:pPr>`
      + `<w:r><w:rPr><w:b/><w:color w:val="${NAVY}"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  };
  const looksLikeMeta = s => /\|/.test(s) || /^\s*(version|owner|review|date|prepared|author|status|confidential|classification|reference|ref|effective|one-page|prepared by)\b/i.test(s) || /\[year\]/i.test(s);
  // Emit the header divider exactly once, before the first body element after the title block.
  const flushHeader = () => { if (pendingHeaderRule) { paras += headerRule(); pendingHeaderRule = false; } expectSubtitle = false; };

  for (const seg of segments) {
    if (seg.type === 'table') {
      flushHeader();
      const rowsData = seg.content.split('\n')
        .map(l => l.trim()).filter(Boolean)
        .map(l => l.split('§CELL§').map(c => c));
      if (rowsData.length) paras += tableToXml(rowsData, theme);
      continue;
    }

    const lines = seg.content.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) {
        paras += `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`;
        continue;
      }
      const trimmed = line.trim();

      // Markdown heading (#, ##, ###...) - tolerate a single stray leading letter
      const hMatch = trimmed.match(/^[a-z]?(#{1,6})\s+(.+)$/);
      // A short, fully-bold line acts as a heading too (e.g. "**Strategic priorities**")
      const boldRuns = parseInlineRuns(trimmed);
      const allBold = boldRuns.length && boldRuns.every(r => r.bold || !r.text.trim());
      const boldHeadingText = allBold && trimmed.replace(/\*\*/g,'').length < 90 ? trimmed.replace(/\*\*/g,'') : null;

      if (hMatch || boldHeadingText) {
        const text = hMatch ? hMatch[2].replace(/\*/g,'').trim() : boldHeadingText;
        const mdLevel = hMatch ? hMatch[1].length : 2;
        if (!titleDone) { paras += headingXml(text, 0); titleDone = true; expectSubtitle = true; pendingHeaderRule = true; }
        else { flushHeader(); paras += headingXml(text, mdLevel); }
        continue;
      }

      // Metadata strip immediately under the title -> muted subtitle (stays inside the header block)
      if (expectSubtitle) {
        expectSubtitle = false;
        if (looksLikeMeta(trimmed)) {
          paras += `<w:p><w:pPr><w:spacing w:before="20" w:after="0"/></w:pPr><w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">${enc(trimmed.replace(/\*\*/g,''))}</w:t></w:r></w:p>`;
          continue;
        }
      }
      flushHeader();

      const bulletMatch = trimmed.match(/^[•\-]\s+([\s\S]*)/);
      if (bulletMatch) {
        const runs = parseInlineRuns(bulletMatch[1]);
        paras += `<w:p><w:pPr><w:ind w:left="360"/><w:spacing w:before="0" w:after="80"/></w:pPr><w:r><w:t xml:space="preserve">• </w:t></w:r>${runsToXml(runs)}</w:p>`;
        continue;
      }
      const runs = boldRuns;
      const hasBold = runs.some(r => r.bold);
      if (hasBold) {
        paras += `<w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr>${runsToXml(runs)}</w:p>`;
      } else {
        const isSection = /^\d+\.\s/.test(trimmed) && !/^\d+\.\d+/.test(trimmed) && trimmed.length < 90;
        if (isSection) { paras += headingXml(trimmed, 2); continue; }
        paras += `<w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr><w:r><w:t xml:space="preserve">${enc(trimmed)}</w:t></w:r></w:p>`;
      }
    }
  }

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${paras}<w:sectPr>
<w:pgSz w:w="12240" w:h="15840"/>
<w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440" w:header="708" w:footer="708"/>
</w:sectPr></w:body></w:document>`;

  // Default the whole document to Arial 10pt (clean, professional) - headings override size/colour.
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const zip = new PizZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('word/document.xml', docXml);
  zip.file('word/styles.xml', stylesXml);
  zip.file('word/_rels/document.xml.rels', wordRels);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Require an authenticated caller for every path (doc render, template fill and transcribe).
  if (!(await verifyAuth(req))) return res.status(401).json({ error: 'Unauthorized' });

  // Transcription action — uses Groq Whisper (server key), so require an authenticated caller
  if (req.body?.action === 'transcribe') {
    if (!(await verifyAuth(req))) return res.status(401).json({ error: 'Unauthorized' });
    const { audio, mimeType = 'audio/webm' } = req.body;
    if (!audio) return res.status(400).json({ error: 'No audio data' });
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
    try {
      const buffer = Buffer.from(audio, 'base64');
      const ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'mp4'
                : mimeType.includes('ogg') ? 'ogg'
                : mimeType.includes('wav') ? 'wav' : 'webm';
      const boundary = '----WhisperBoundary' + Date.now();
      const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
      const footer = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n--${boundary}--\r\n`);
      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: Buffer.concat([header, buffer, footer]),
      });
      if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: err.substring(0, 200) }); }
      const result = await response.json();
      return res.status(200).json({ text: result.text || '' });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  try {
    const { templateBase64, fields, plainText, templateName, accent } = req.body;
    const safeName = (templateName||'document').replace(/[^a-z0-9 _-]/gi,'').trim() || 'document';
    if (!templateBase64 && plainText) {
      const buf = textToDocxBuffer(plainText, resolveTheme(accent));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
      return res.status(200).send(buf);
    }
    if (!templateBase64 || !fields) return res.status(400).json({ error: 'Missing template or fields' });
    const templateBuffer = Buffer.from(templateBase64, 'base64');
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    doc.render(fields);
    const outputBuffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
    return res.status(200).send(outputBuffer);
  } catch (error) {
    console.error('Doc generation error:', error);
    return res.status(500).json({ error: error.message });
  }
}
