import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const enc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

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

  for (const seg of segments) {
    if (seg.type === 'table') {
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
