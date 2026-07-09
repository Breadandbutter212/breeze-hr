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

// Apply manual paragraph edits to a filled .docx's body without disturbing headers, footers,
// images, styles or section properties. For each <w:p> whose visible text matches an edit's
// `find`, the replacement text is written into the paragraph's first <w:t> and the remaining
// text runs are blanked - drawings/images and every other element are left untouched.
function applyParagraphEdits(xml, edits) {
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const decode = s => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
  const encode = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const map = new Map();
  for (const e of edits) { const f = norm(e && e.find); if (f) map.set(f, e && e.replace == null ? '' : String(e.replace)); }
  if (!map.size) return xml;
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    if (para.indexOf('<w:t') === -1) return para;
    const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g; let m; const parts = [];
    while ((m = tRe.exec(para)) !== null) parts.push(m[1]);
    const full = norm(decode(parts.join('')));
    if (!map.has(full)) return para;
    const replacement = map.get(full);
    let first = true;
    return para.replace(/(<w:t\b)([^>]*)(>)([\s\S]*?)(<\/w:t>)/g, (mm, o1, attrs, o3, _t, close) => {
      if (first) {
        first = false;
        if (!/xml:space=/.test(attrs)) attrs += ' xml:space="preserve"';
        return o1 + attrs + o3 + encode(replacement) + close;
      }
      return o1 + attrs + o3 + close; // blank the remaining runs in this paragraph
    });
  });
}

// Graft the original .docx's headers, footers, their images and page setup onto a rebuilt body
// (the html-docx export of the user's edited preview). The body carries ALL edits - bold, fonts,
// bullets, added/deleted paragraphs - while the header/footer come byte-for-byte from the original.
// Returns a Buffer, or null if there's nothing to graft / inputs are unusable (caller falls back).
function graftHeadersFooters(htmlBuf, origBuf) {
  const htmlZip = new PizZip(htmlBuf);
  const origZip = new PizZip(origBuf);
  const txt = (zip, p) => { const f = zip.file(p); return f ? f.asText() : null; };

  let htmlDoc = txt(htmlZip, 'word/document.xml');
  const origDoc = txt(origZip, 'word/document.xml');
  if (!htmlDoc || !origDoc) return null;

  // The original's final sectPr holds page size/margins + header/footer references.
  const secMatches = origDoc.match(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g);
  const origSectPr = secMatches ? secMatches[secMatches.length - 1] : null;
  if (!origSectPr) return null;

  const origRels = txt(origZip, 'word/_rels/document.xml.rels') || '';
  const relTarget = (rid) => {
    const m = origRels.match(new RegExp('<Relationship\\b[^>]*Id="' + rid + '"[^>]*Target="([^"]+)"', 'i'))
           || origRels.match(new RegExp('<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="' + rid + '"', 'i'));
    return m ? m[1] : null;
  };

  // Collect every header/footer reference from the original sectPr.
  const parts = [];
  const refRe = /<w:(header|footer)Reference\b([^>]*?)\/>/g; let rm;
  while ((rm = refRe.exec(origSectPr)) !== null) {
    const kind = rm[1], attrs = rm[2];
    const idM = attrs.match(/r:id="([^"]+)"/); if (!idM) continue;
    let target = relTarget(idM[1]); if (!target) continue;
    target = target.replace(/^\.\.\//, '').replace(/^\/?word\//, '').replace(/^\//, '');
    const tyM = attrs.match(/w:type="([^"]+)"/);
    parts.push({ kind, wtype: tyM ? tyM[1] : 'default', file: target });
  }
  if (!parts.length) return null; // no header/footer to preserve

  let htmlRels = txt(htmlZip, 'word/_rels/document.xml.rels')
    || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let ctypes = txt(htmlZip, '[Content_Types].xml');
  if (!ctypes) return null;

  const CT_MAP = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', bmp:'image/bmp', tiff:'image/tiff', tif:'image/tiff', emf:'image/x-emf', wmf:'image/x-wmf', svg:'image/svg+xml' };
  const ensureDefault = (ext) => {
    if (!new RegExp('Extension="' + ext + '"', 'i').test(ctypes)) {
      ctypes = ctypes.replace('</Types>', `<Default Extension="${ext}" ContentType="${CT_MAP[ext] || 'application/octet-stream'}"/></Types>`);
    }
  };
  const usedMedia = new Set(Object.keys(htmlZip.files).filter(n => /^word\/media\//.test(n)).map(n => n.replace('word/media/', '')));

  let rid = 7100;
  const headerRefs = [], footerRefs = [];
  for (const part of parts) {
    const partXml = txt(origZip, 'word/' + part.file);
    if (!partXml) continue;

    // Copy the part's media (logo etc.), renamed to avoid any clash, updating the part's rels.
    const relsPath = 'word/_rels/' + part.file + '.rels';
    let partRels = txt(origZip, relsPath);
    if (partRels) {
      partRels = partRels.replace(/(Target=")([^"]+)(")/g, (mm, a, tgt, b) => {
        const norm = tgt.replace(/^\.\.\//, '').replace(/^\/?word\//, '');
        if (!/^media\//i.test(norm)) return mm; // leave hyperlinks etc.
        const src = origZip.file('word/' + norm); if (!src) return mm;
        const baseName = norm.replace(/^media\//, '');
        let name = 'graft_' + baseName, i = 1;
        while (usedMedia.has(name)) name = 'graft' + (i++) + '_' + baseName;
        usedMedia.add(name);
        htmlZip.file('word/media/' + name, src.asUint8Array(), { binary: true });
        ensureDefault((name.split('.').pop() || 'png').toLowerCase());
        return a + 'media/' + name + b;
      });
      htmlZip.file(relsPath, partRels);
    }

    htmlZip.file('word/' + part.file, partXml);
    const ct = part.kind === 'header'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
    if (!ctypes.includes('PartName="/word/' + part.file + '"')) {
      ctypes = ctypes.replace('</Types>', `<Override PartName="/word/${part.file}" ContentType="${ct}"/></Types>`);
    }
    const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + part.kind;
    const id = 'rIdGr' + (rid++);
    htmlRels = htmlRels.replace('</Relationships>', `<Relationship Id="${id}" Type="${relType}" Target="${part.file}"/></Relationships>`);
    (part.kind === 'header' ? headerRefs : footerRefs).push(`<w:${part.kind}Reference w:type="${part.wtype}" r:id="${id}"/>`);
  }

  const refBlock = headerRefs.join('') + footerRefs.join('');
  if (!refBlock) return null;

  // Header/footer references must be the FIRST children of <w:sectPr>. Also adopt the original's
  // page size and margins so the layout matches.
  const pgSz = (origSectPr.match(/<w:pgSz\b[^>]*\/>/) || [''])[0];
  const pgMar = (origSectPr.match(/<w:pgMar\b[^>]*\/>/) || [''])[0];
  htmlDoc = htmlDoc.replace(/<w:sectPr\b([^>]*)>/, (mm, a) => `<w:sectPr${a}>${refBlock}`);
  if (pgSz) htmlDoc = /<w:pgSz\b[^>]*\/>/.test(htmlDoc) ? htmlDoc.replace(/<w:pgSz\b[^>]*\/>/, pgSz) : htmlDoc.replace('</w:sectPr>', pgSz + '</w:sectPr>');
  if (pgMar) htmlDoc = /<w:pgMar\b[^>]*\/>/.test(htmlDoc) ? htmlDoc.replace(/<w:pgMar\b[^>]*\/>/, pgMar) : htmlDoc.replace('</w:sectPr>', pgMar + '</w:sectPr>');
  if (!/xmlns:r=/.test(htmlDoc)) htmlDoc = htmlDoc.replace(/<w:document\b/, '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');

  htmlZip.file('word/document.xml', htmlDoc);
  htmlZip.file('word/_rels/document.xml.rels', htmlRels);
  htmlZip.file('[Content_Types].xml', ctypes);
  return htmlZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
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

  // Graft action — merge the original .docx's header/footer/page-setup onto an edited body.
  if (req.body?.action === 'graft') {
    const { htmlDocxBase64, templateBase64, templateName } = req.body;
    if (!htmlDocxBase64 || !templateBase64) return res.status(400).json({ error: 'Missing document data' });
    try {
      const merged = graftHeadersFooters(Buffer.from(htmlDocxBase64, 'base64'), Buffer.from(templateBase64, 'base64'));
      if (!merged) return res.status(422).json({ error: 'Nothing to graft' });
      const safeName = (templateName || 'document').replace(/[^a-z0-9 _-]/gi, '').trim() || 'document';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
      return res.status(200).send(merged);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

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
    const { templateBase64, fields, plainText, templateName, accent, edits } = req.body;
    const safeName = (templateName||'document').replace(/[^a-z0-9 _-]/gi,'').trim() || 'document';
    // Premium path (beta): Claude builds the .docx natively via the code execution tool.
    // Falls back to the standard converter on any failure so the caller always gets a document.
    if (req.body?.premium && (plainText || req.body?.markdown)) {
      const source = req.body.markdown || plainText;
      try {
        const { generatePremiumDocx } = await import('./_premium-docx.mjs');
        const { buffer, cost } = await generatePremiumDocx(source, accent);
        res.setHeader('X-Premium-Status', 'ok');
        res.setHeader('X-Premium-Cost', Number(cost || 0).toFixed(4));
        res.setHeader('Access-Control-Expose-Headers', 'X-Premium-Status, X-Premium-Cost');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
        return res.status(200).send(buffer);
      } catch (e) {
        console.error('Premium docx failed, falling back to converter:', e.message);
        const { renderDocx } = await import('./_docx-render.mjs');
        const buf = await renderDocx(plainText || source, resolveTheme(accent));
        res.setHeader('X-Premium-Status', 'fallback: ' + String(e.message || 'error').slice(0, 140));
        res.setHeader('Access-Control-Expose-Headers', 'X-Premium-Status, X-Premium-Cost');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
        return res.status(200).send(buf);
      }
    }

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
    const outZip = doc.getZip();
    // Apply any manual paragraph edits to the body, leaving header/footer/images/styles intact.
    if (Array.isArray(edits) && edits.length) {
      try {
        const docXmlFile = outZip.file('word/document.xml');
        if (docXmlFile) outZip.file('word/document.xml', applyParagraphEdits(docXmlFile.asText(), edits));
      } catch (e) { /* keep the field-filled version if the patch fails */ }
    }
    const outputBuffer = outZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
    return res.status(200).send(outputBuffer);
  } catch (error) {
    console.error('Doc generation error:', error);
    return res.status(500).json({ error: error.message });
  }
}
