import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const enc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function textToDocxBuffer(text, title) {
  const lines = (text||'').split('\n');
  let paras = '';

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      paras += `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`;
      continue;
    }
    // Detect section headings: "1. TITLE" / "1.1 Something" / short ALL-CAPS lines
    const isSection = /^\d+\.\d*\s/.test(line.trim());
    const isAllCaps = line.trim().length < 70 && line.trim() === line.trim().toUpperCase() && /[A-Z]{3}/.test(line);
    const bold = isSection || isAllCaps;
    const spaceBefore = bold ? '200' : '0';
    const spaceAfter  = bold ? '80'  : '100';
    const rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
    paras += `<w:p><w:pPr><w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${enc(line)}</w:t></w:r></w:p>`;
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { templateBase64, fields, plainText, templateName } = req.body;
    const safeName = (templateName||'document').replace(/[^a-z0-9 _-]/gi,'').trim() || 'document';

    // Plain text path — build a real .docx from scratch with PizZip
    if (!templateBase64 && plainText) {
      const buf = textToDocxBuffer(plainText, safeName);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
      return res.status(200).send(buf);
    }

    if (!templateBase64 || !fields) {
      return res.status(400).json({ error: 'Missing template or fields' });
    }

    // Template path — fill .docx placeholders with Docxtemplater
    const templateBuffer = Buffer.from(templateBase64, 'base64');
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => ''
    });
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
