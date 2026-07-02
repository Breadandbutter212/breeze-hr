import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { createClient } from '@supabase/supabase-js';


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
      const { renderDocx } = await import('./_docx-render.mjs');
      const buf = await renderDocx(plainText, resolveTheme(accent));
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
