from http.server import BaseHTTPRequestHandler
import json
import base64
import io
import copy

R_EMBED = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed'
R_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

def clone_slide_with_images(prs, source_idx):
    """Clone a slide preserving images, background shapes and decorative elements."""
    from pptx.oxml.ns import qn
    source = prs.slides[source_idx]
    new_slide = prs.slides.add_slide(source.slide_layout)

    # Clear shapes added by add_slide
    dest_tree = new_slide.shapes._spTree
    for el in list(dest_tree):
        dest_tree.remove(el)

    rId_map = {}
    for el in source.shapes._spTree:
        tag = el.tag.split('}')[-1]
        if tag == 'pic':
            blip = el.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}blip')
            if blip is not None:
                old_rId = blip.get(R_EMBED)
                if old_rId and old_rId not in rId_map:
                    try:
                        image_part = source.part.related_part(old_rId)
                        new_rId = new_slide.part.relate_to(image_part, R_IMAGE)
                        rId_map[old_rId] = new_rId
                    except Exception:
                        pass
            new_el = copy.deepcopy(el)
            blip_new = new_el.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}blip')
            if blip_new is not None:
                old_rId = blip_new.get(R_EMBED)
                if old_rId in rId_map:
                    blip_new.set(R_EMBED, rId_map[old_rId])
            dest_tree.append(new_el)
        else:
            dest_tree.append(copy.deepcopy(el))

    return new_slide

def overwrite_title_text(ph, new_title):
    """Slide is already a clone - just swap the text in the existing runs. Touch nothing else."""
    from pptx.oxml.ns import qn
    txBody = ph.text_frame._txBody
    # Find all a:t elements in the title and set the first one, clear the rest
    all_t = txBody.findall('.//' + qn('a:t'))
    if all_t:
        all_t[0].text = new_title
        for t in all_t[1:]:
            t.text = ''
    else:
        # Fallback: no runs found - use tf.text
        ph.text_frame.text = new_title

def overwrite_body_text(ph, bullets):
    """Slide is already a clone - replace body paragraph texts. Clone first run for formatting."""
    from pptx.oxml.ns import qn
    from lxml import etree
    if not bullets:
        return
    txBody = ph.text_frame._txBody
    paras = txBody.findall(qn('a:p'))
    if not paras:
        return

    # Use first existing paragraph as formatting template
    ref_para = copy.deepcopy(paras[0])

    # Remove all existing paragraphs
    for p in paras:
        txBody.remove(p)

    for bullet in bullets:
        new_p = copy.deepcopy(ref_para)
        # Set text in first run, clear rest
        all_t = new_p.findall('.//' + qn('a:t'))
        if all_t:
            all_t[0].text = bullet
            for t in all_t[1:]:
                t.text = ''
        txBody.append(new_p)

def apply_ops(prs, ops):
    from pptx.oxml.ns import qn
    from pptx.enum.shapes import PP_PLACEHOLDER
    from lxml import etree

    TITLE_TYPES = (PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE)

    for op in ops:
        op_type = op.get('op', '')
        # 'slide' is a number for add_bullet/update_* but a dict for insert_slide - guard carefully
        raw_slide = op.get('slide', 1)
        slide_num = raw_slide if isinstance(raw_slide, int) else 1
        slide_idx = slide_num - 1

        # ── ADD BULLET ──────────────────────────────────────────────────────────
        if op_type == 'add_bullet' and 0 <= slide_idx < len(prs.slides):
            slide = prs.slides[slide_idx]
            bullet_text = op.get('bullet', '')
            after_text  = op.get('after_text', '').strip().lower()

            best_tf      = None
            best_para_idx = None

            for shape in slide.shapes:
                if not shape.has_text_frame:
                    continue
                tf = shape.text_frame

                if after_text:
                    for i, para in enumerate(tf.paragraphs):
                        if after_text in para.text.strip().lower():
                            best_tf = tf
                            best_para_idx = i
                            break
                    if best_tf:
                        break
                else:
                    # Pick the frame with the most content paragraphs
                    content_count = sum(1 for p in tf.paragraphs if p.text.strip())
                    if best_tf is None or content_count > sum(1 for p in best_tf.paragraphs if p.text.strip()):
                        best_tf = tf

            if best_tf is None:
                continue

            # Clone the reference paragraph for formatting
            paras = best_tf.paragraphs
            ref_idx = best_para_idx if best_para_idx is not None else len(paras) - 1
            ref_p = paras[ref_idx]._p

            new_p = copy.deepcopy(ref_p)

            # Clear all runs from the clone, keep pPr
            for r in new_p.findall(qn('a:r')):
                new_p.remove(r)
            for br in new_p.findall(qn('a:br')):
                new_p.remove(br)

            # Build a run using the first run's rPr from the reference (preserves font/size)
            ref_runs = ref_p.findall(qn('a:r'))
            if ref_runs:
                new_r = copy.deepcopy(ref_runs[0])
                t = new_r.find(qn('a:t'))
                if t is None:
                    t = etree.SubElement(new_r, qn('a:t'))
                t.text = bullet_text
            else:
                new_r = etree.SubElement(new_p, qn('a:r'))
                t = etree.SubElement(new_r, qn('a:t'))
                t.text = bullet_text

            new_p.append(new_r)

            # Insert after the reference paragraph
            ref_p.addnext(new_p)

        # ── INSERT SLIDE ─────────────────────────────────────────────────────────
        elif op_type == 'insert_slide':
            after_num  = op.get('after', len(prs.slides))
            slide_data = op.get('slide', {})
            title_text = slide_data.get('title', 'New Slide')
            bullets    = slide_data.get('bullets', [])

            # Find the best content slide to clone (has title + body, no SmartArt)
            template_idx = 1
            for i, sl in enumerate(prs.slides):
                has_title  = any(ph.placeholder_format.type in TITLE_TYPES for ph in sl.placeholders)
                has_body   = any(ph.placeholder_format.idx == 1 for ph in sl.placeholders)
                has_smartart = any(
                    hasattr(sh, 'shape_type') and sh.shape_type == 15  # MSO_SHAPE_TYPE.SMART_ART
                    for sh in sl.shapes
                )
                if has_title and has_body and not has_smartart:
                    template_idx = i
                    break

            # Clone slide with working image relationships
            template_slide = prs.slides[template_idx]
            new_slide = clone_slide_with_images(prs, template_idx)

            # Slide is a clone - just overwrite text in existing runs, touch nothing else
            for ph in new_slide.placeholders:
                ph_type = ph.placeholder_format.type
                ph_idx  = ph.placeholder_format.idx
                if ph_type in TITLE_TYPES:
                    overwrite_title_text(ph, title_text)
                elif ph_idx == 1:
                    overwrite_body_text(ph, bullets)

            # Move to correct position (add_slide always appends)
            xml_slides = prs.slides._sldIdLst
            slides_list = list(xml_slides)
            new_el = slides_list[-1]
            xml_slides.remove(new_el)
            insert_pos = min(int(after_num), len(list(xml_slides)))
            xml_slides.insert(insert_pos, new_el)

        # ── UPDATE TITLE ──────────────────────────────────────────────────────────
        elif op_type == 'update_title' and 0 <= slide_idx < len(prs.slides):
            slide = prs.slides[slide_idx]
            new_title = op.get('title', '')
            for ph in slide.placeholders:
                if ph.placeholder_format.type in TITLE_TYPES:
                    ph.text = new_title
                    break

        # ── UPDATE BULLETS ────────────────────────────────────────────────────────
        elif op_type == 'update_bullets' and 0 <= slide_idx < len(prs.slides):
            slide = prs.slides[slide_idx]
            new_bullets = op.get('bullets', [])
            # Find body placeholder
            for ph in slide.placeholders:
                if ph.placeholder_format.idx == 1:
                    tf = ph.text_frame
                    tf.clear()
                    for i, b in enumerate(new_bullets):
                        if i == 0:
                            tf.paragraphs[0].text = b
                        else:
                            p = tf.add_paragraph()
                            p.text = b
                    break

        # ── UPDATE DATES ──────────────────────────────────────────────────────────
        elif op_type == 'update_dates':
            import re
            year = str(op.get('year', ''))
            if year:
                for slide in prs.slides:
                    for shape in slide.shapes:
                        if shape.has_text_frame:
                            for para in shape.text_frame.paragraphs:
                                for run in para.runs:
                                    run.text = re.sub(r'\b20\d{2}\b', year, run.text)


def _rgb(h):
    h = h.lstrip('#')
    return __import__('pptx.dml.color', fromlist=['RGBColor']).RGBColor(int(h[0:2],16), int(h[2:4],16), int(h[4:6],16))

def _rect(slide, l, t, w, h, color):
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    s = slide.shapes.add_shape(1, l, t, w, h)  # 1 = rectangle
    s.fill.solid(); s.fill.fore_color.rgb = color
    s.line.fill.background()
    return s

def _txt(slide, text, l, t, w, h, size, color, bold=False, align=None, wrap=True):
    from pptx.util import Pt
    from pptx.enum.text import PP_ALIGN
    bx = slide.shapes.add_textbox(l, t, w, h)
    tf = bx.text_frame; tf.word_wrap = wrap
    p = tf.paragraphs[0]
    if align: p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size); run.font.color.rgb = color
    run.font.bold = bold; run.font.name = 'Calibri'
    return bx

def _bullets(slide, bullets, l, t, w, h, size, color):
    from pptx.util import Pt
    bx = slide.shapes.add_textbox(l, t, w, h)
    tf = bx.text_frame; tf.word_wrap = True
    for i, b in enumerate(bullets):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_before = Pt(3)
        run = p.add_run()
        run.text = f'• {b}'
        run.font.size = Pt(size); run.font.color.rgb = color; run.font.name = 'Calibri'
    return bx

def generate_deck(slides, accent_hex, dark_hex, prs_title):
    from pptx import Presentation
    from pptx.util import Inches, Pt, Emu
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
    from pptx.chart.data import ChartData
    from pptx.enum.chart import XL_CHART_TYPE

    SW, SH = Inches(13.33), Inches(7.5)
    ACC  = _rgb(accent_hex or '475569')
    DARK = _rgb(dark_hex   or '1E293B')
    WHITE = RGBColor(0xFF,0xFF,0xFF)
    INK   = RGBColor(0x37,0x41,0x51)

    prs = Presentation()
    prs.slide_width = SW; prs.slide_height = SH
    blank = prs.slide_layouts[6]

    for s in slides:
        sl = prs.slides.add_slide(blank)
        st = s.get('type','content')
        title   = s.get('title','')
        bullets = s.get('bullets',[])
        subtitle = s.get('subtitle','')

        if st == 'title':
            _rect(sl, 0, 0, SW, SH, DARK)
            _txt(sl, title, Inches(.6), Inches(2.2), Inches(11), Inches(1.4), 40, WHITE, bold=True, align=PP_ALIGN.LEFT)
            if subtitle: _txt(sl, subtitle, Inches(.6), Inches(3.7), Inches(9), Inches(.6), 20, ACC)
            _rect(sl, Inches(.6), Inches(5), Inches(1.2), Emu(72000), ACC)

        elif st == 'section':
            _rect(sl, 0, 0, SW, SH, ACC)
            _txt(sl, title, Inches(.6), Inches(2.5), Inches(11), Inches(1.2), 36, WHITE, bold=True, align=PP_ALIGN.CENTER)

        elif st == 'close':
            _rect(sl, 0, 0, SW, SH, DARK)
            _txt(sl, title or 'Questions?', Inches(.6), Inches(2), Inches(11), Inches(1.2), 40, WHITE, bold=True, align=PP_ALIGN.CENTER)
            if bullets: _txt(sl, bullets[0], Inches(.6), Inches(3.4), Inches(9), Inches(.6), 18, ACC, align=PP_ALIGN.CENTER)

        elif st == 'image':
            _rect(sl, 0, 0, SW, Inches(1.1), DARK)
            _txt(sl, title, Inches(.4), Inches(.15), Inches(11.4), Inches(.8), 22, WHITE, bold=True)
            _rect(sl, Inches(.5), Inches(1.25), Inches(7.5), Inches(5.5), RGBColor(0xF1,0xF5,0xF9))
            hint = s.get('imageHint','Add image here')
            _txt(sl, f'\U0001f4f7  {hint}', Inches(.5), Inches(3.3), Inches(7.5), Inches(.8), 13, RGBColor(0x94,0xA3,0xB8), align=PP_ALIGN.CENTER)
            if bullets: _bullets(sl, bullets, Inches(8.2), Inches(1.35), Inches(5), Inches(5.3), 15, INK)

        elif st == 'chart':
            _rect(sl, 0, 0, SW, Inches(1.1), DARK)
            _txt(sl, title, Inches(.4), Inches(.15), Inches(11.4), Inches(.8), 22, WHITE, bold=True)
            labels  = s.get('labels',[])
            series  = s.get('series',[])
            ct_str  = s.get('chartType','bar')
            ct_map  = {'bar': XL_CHART_TYPE.COLUMN_CLUSTERED, 'barh': XL_CHART_TYPE.BAR_CLUSTERED,
                       'line': XL_CHART_TYPE.LINE, 'pie': XL_CHART_TYPE.PIE, 'doughnut': XL_CHART_TYPE.DOUGHNUT}
            ct = ct_map.get(ct_str, XL_CHART_TYPE.COLUMN_CLUSTERED)
            if labels and series:
                cd = ChartData()
                cd.categories = labels
                for ser in series:
                    vals = [float(v) if str(v).replace('.','').replace('-','').isdigit() else 0 for v in ser.get('values',[])]
                    cd.add_series(ser.get('name',''), vals)
                chart = sl.shapes.add_chart(ct, Inches(.5), Inches(1.25), Inches(12.3), Inches(5.5), cd).chart
                chart.has_legend = len(series) > 1
            note = s.get('note','')
            if note: _txt(sl, note, Inches(.5), Inches(6.9), Inches(12), Inches(.3), 9, RGBColor(0x9C,0xA3,0xAF))

        else:  # content
            _rect(sl, 0, 0, SW, Inches(1.1), DARK)
            _txt(sl, title, Inches(.4), Inches(.15), Inches(11.4), Inches(.8), 22, WHITE, bold=True)
            if bullets: _bullets(sl, bullets, Inches(.5), Inches(1.3), Inches(11.2), Inches(4.5), 16, INK)

    return prs

class handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress request logging

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_POST(self):
        try:
            from pptx import Presentation

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            pptx_b64 = data.get('pptxBase64', '')
            ops      = data.get('ops', [])
            action   = data.get('action', 'edit' if pptx_b64 else 'generate')

            if action == 'generate':
                slides     = data.get('slides', [])
                accent     = data.get('accent', '475569')
                dark       = data.get('dark',   '1E293B')
                prs_title  = data.get('title', 'Presentation')
                prs = generate_deck(slides, accent, dark, prs_title)
            else:
                if not pptx_b64:
                    self._error(400, 'Missing pptxBase64')
                    return
                pptx_bytes = base64.b64decode(pptx_b64)
                prs = Presentation(io.BytesIO(pptx_bytes))
                apply_ops(prs, ops)

            output = io.BytesIO()
            prs.save(output)
            output.seek(0)
            result_b64 = base64.b64encode(output.read()).decode()

            self._json(200, {'pptxBase64': result_b64})

        except Exception as e:
            self._error(500, str(e))

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code, msg):
        self._json(code, {'error': msg})
