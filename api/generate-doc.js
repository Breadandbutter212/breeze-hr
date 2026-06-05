import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const enc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function parseInlineRuns(line) {
  const parts = line.split(/\*\*(.*?)\*\*/g);
  return parts.map((text, i) => ({ text, bold: i % 2 === 1 })).filter(r => r.text);
}

function runsToXml(runs) {
  return runs.map(r => {
    const rPr = r.bold ? '<w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>' : '<w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';
    return `<w:r>${rPr}<w:t xml:space="preserve">${enc(r.text)}</w:t></w:r>`;
  }).join('');
}

// Generate Word XML for a table from marker format
// rowsData: array of arrays of cell strings (already has **bold** markers)
function tableToXml(rowsData) {
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>`;
  const tblBorders = `<w:tblBorders>${['top','left','bottom','right','insideH'].map(border).join('')}<w:insideV w:val="none"/></w:tblBorders>`;

  const rowXml = rowsData.map(cells => {
    const colW = Math.floor(9360 / cells.length); // fit in ~6.5 inch body
    const tcXml = cells.map((cell, i) => {
      const isLabel = cells.length === 2 && i === 0;
      const fill = isLabel ? 'F1F5F9' : 'FFFFFF';
      const runs = parseInlineRuns(cell);
      const cellBorders = `<w:tcBorders>${['top','left','bottom','right'].map(border).join('')}</w:tcBorders>`;
      return `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>${cellBorders}</w:tcPr><w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>${runsToXml(runs)}</w:p></w:tc>`;
    }).join('');
    return `<w:tr>${tcXml}</w:tr>`;
  }).join('');

  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/>${tblBorders}<w:tblLook w:val="0000"/></w:tblPr>${rowXml}</w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="160"/></w:pPr></w:p>`;
}

function textToDocxBuffer(text) {
  // Pre-process: extract [TABLE]...[/TABLE] blocks so we can interleave
  // Segment the text into {type:'text'|'table', content} chunks
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

  for (const seg of segments) {
    if (seg.type === 'table') {
      // Parse rows: each non-empty line is §CELL§-joined cells
      const rowsData = seg.content.split('\n')
        .map(l => l.trim()).filter(Boolean)
        .map(l => l.split('§CELL§').map(c => c.trim()));
      if (rowsData.length) paras += tableToXml(rowsData);
      continue;
    }

    // Normal text processing
    const lines = seg.content.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) {
        paras += `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`;
        continue;
      }
      const trimmed = line.trim();

      // Bullet
      const bulletMatch = trimmed.match(/^[•\-]\s+([\s\S]*)/);
      if (bulletMatch) {
        const runs = parseInlineRuns(bulletMatch[1]);
        paras += `<w:p><w:pPr><w:ind w:left="360"/><w:spacing w:before="0" w:after="80"/></w:pPr><w:r><w:t xml:space="preserve">• </w:t></w:r>${runsToXml(runs)}</w:p>`;
        continue;
      }

      const runs = parseInlineRuns(trimmed);
      const hasBold = runs.some(r => r.bold);
      const allBold = hasBold && runs.every(r => r.bold || !r.text.trim());

      if (allBold) {
        paras += `<w:p><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr>${runsToXml(runs)}</w:p>`;
      } else if (hasBold) {
        paras += `<w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr>${runsToXml(runs)}</w:p>`;
      } else {
        const isSection = /^\d+\.\s/.test(trimmed) && !/^\d+\.\d+/.test(trimmed);
        const spaceBefore = isSection ? '200' : '0';
        const spaceAfter  = isSection ? '80'  : '100';
        const rPr = isSection ? '<w:rPr><w:b/></w:rPr>' : '';
        paras += `<w:p><w:pPr><w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${enc(trimmed)}</w:t></w:r></w:p>`;
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
  try {
    const { templateBase64, fields, plainText, templateName } = req.body;
    const safeName = (templateName||'document').replace(/[^a-z0-9 _-]/gi,'').trim() || 'document';
    if (!templateBase64 && plainText) {
      const buf = textToDocxBuffer(plainText, safeName);
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
