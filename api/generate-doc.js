import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { createClient } from '@supabase/supabase-js';

const enc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

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
function tableToXml(rowsData) {
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

    const tcXml = cells.map((cell, ci) => {
      const fill = isHdrRow ? '1B2D50' : (ci === 0 && cells.length > 1 ? 'F8FAFC' : 'FFFFFF');
      const textColor = isHdrRow ? '<w:color w:val="FFFFFF"/>' : '';
      const bdrXml = `<w:tcBorders>${['top','left','bottom','right'].map(bdr).join('')}</w:tcBorders>`;
      const spanAttr = isWide ? `<w:gridSpan w:val="${colCount}"/>` : '';
      const tcW = isWide ? 9360 : colW;
      const cellPr = `<w:tcPr><w:tcW w:w="${tcW}" w:type="dxa"/>${spanAttr}<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>${bdrXml}</w:tcPr>`;

      let parasXml;
      if (isHdrRow) {
        // Bold white text in header
        const runs = parseInlineRuns(cell);
        parasXml = `<w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>${runs.map(r=>`<w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${enc(r.text)}</w:t></w:r>`).join('')}</w:p>`;
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

function textToDocxBuffer(text) {
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
  // Document accent colour (matches the in-app doc panel) and a muted tone for metadata.
  const NAVY = '1B2D50', MUTED = '6B7280';
  let titleDone = false;     // the first heading becomes the document Title
  let expectSubtitle = false; // a metadata strip directly under the title renders muted

  // A styled heading paragraph. level 0 = Title, 1 = H1, 2 = H2, 3+ = H3.
  const headingXml = (textPlain, level) => {
    const t = enc(textPlain.trim());
    if (level === 0) {
      return `<w:p><w:pPr><w:spacing w:before="0" w:after="60"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="6" w:color="${NAVY}"/></w:pBdr></w:pPr>`
        + `<w:r><w:rPr><w:b/><w:color w:val="${NAVY}"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    }
    const sz = level === 1 ? 30 : level === 2 ? 26 : 23;
    const color = level >= 3 ? '374151' : NAVY;
    const before = level === 1 ? 280 : level === 2 ? 220 : 160;
    return `<w:p><w:pPr><w:spacing w:before="${before}" w:after="70"/></w:pPr>`
      + `<w:r><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  };
  const looksLikeMeta = s => /\|/.test(s) || /^\s*(version|owner|review|date|prepared|author|status|confidential|classification|reference|ref|effective)\b/i.test(s) || /\[year\]/i.test(s);

  for (const seg of segments) {
    if (seg.type === 'table') {
      expectSubtitle = false;
      const rowsData = seg.content.split('\n')
        .map(l => l.trim()).filter(Boolean)
        .map(l => l.split('§CELL§').map(c => c));
      if (rowsData.length) paras += tableToXml(rowsData);
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
        if (!titleDone) { paras += headingXml(text, 0); titleDone = true; expectSubtitle = true; }
        else { paras += headingXml(text, mdLevel); expectSubtitle = false; }
        continue;
      }

      // Metadata strip immediately under the title -> muted subtitle
      if (expectSubtitle) {
        expectSubtitle = false;
        if (looksLikeMeta(trimmed)) {
          paras += `<w:p><w:pPr><w:spacing w:before="20" w:after="160"/></w:pPr><w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${enc(trimmed.replace(/\*\*/g,''))}</w:t></w:r></w:p>`;
          continue;
        }
      }

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
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
</w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const zip = new PizZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('word/document.xml', docXml);
  zip.file('word/_rels/document.xml.rels', wordRels);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
    const { templateBase64, fields, plainText, templateName } = req.body;
    const safeName = (templateName||'document').replace(/[^a-z0-9 _-]/gi,'').trim() || 'document';
    if (!templateBase64 && plainText) {
      const buf = textToDocxBuffer(plainText);
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
