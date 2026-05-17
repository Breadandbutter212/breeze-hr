import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function textToWordHtml(text, title) {
  const paras = text.split('\n').map(l =>
    `<p style="margin:0 0 6pt;">${escHtml(l) || '&nbsp;'}</p>`
  ).join('');
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
<head><meta charset='utf-8'><title>${escHtml(title)}</title>
<style>
  body { font-family:Calibri,Arial,sans-serif; font-size:11pt; line-height:1.6; margin:2cm 2.5cm; color:#1D1D1F; }
  h1  { font-size:14pt; margin:0 0 12pt; }
</style>
</head>
<body>
<h1>${escHtml(title)}</h1>
${paras}
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { templateBase64, fields, plainText, templateName } = req.body;

    // Plain text path — generate an HTML-based .doc (Word-compatible)
    if (!templateBase64 && plainText) {
      const name = templateName || 'document';
      const html = textToWordHtml(plainText, name);
      res.setHeader('Content-Type', 'application/msword');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.doc"`);
      return res.status(200).send(html);
    }

    if (!templateBase64 || !fields) {
      return res.status(400).json({ error: 'Missing template or fields' });
    }

    // Template path — fill .docx with field values
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
    res.setHeader('Content-Disposition', `attachment; filename="${(templateName||'letter').replace(/[^a-z0-9 _-]/gi,'')}.docx"`);
    return res.status(200).send(outputBuffer);

  } catch (error) {
    console.error('Doc generation error:', error);
    return res.status(500).json({ error: error.message });
  }
}
