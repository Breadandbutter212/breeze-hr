import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { templateBase64, fields } = req.body;

    if (!templateBase64 || !fields) {
      return res.status(400).json({ error: 'Missing template or fields' });
    }

    // Decode the base64 template
    const templateBuffer = Buffer.from(templateBase64, 'base64');

    // Load the docx template
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // Don't throw on missing fields — just leave them blank
      nullGetter: () => ''
    });

    // Fill in all the fields
    doc.render(fields);

    // Generate the output as a buffer
    const outputBuffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    });

    // Send back as a downloadable .docx file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="letter.docx"`);
    res.status(200).send(outputBuffer);

  } catch (error) {
    console.error('Doc generation error:', error);
    return res.status(500).json({ error: error.message });
  }
}
