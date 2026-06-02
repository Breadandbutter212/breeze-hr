from http.server import BaseHTTPRequestHandler
import json
import base64
import io
import copy
import os

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


# ── GENERATION HELPERS (Claude.ai verified approach) ────────────────────────
import math

class BRAND:
    DARK   = None; DARKER = None; ACCENT = None
    TEXT   = None; MUTED  = None; FAINT  = None
    WHITE  = None; LIGHT  = None; LIGHTTXT = None
    HEAD_FONT = "Trebuchet MS"; BODY_FONT = "Calibri"

    @classmethod
    def init(cls, accent_hex, dark_hex):
        from pptx.dml.color import RGBColor
        def rgb(h): h=h.lstrip('#'); return RGBColor(int(h[0:2],16),int(h[2:4],16),int(h[4:6],16))
        cls.ACCENT   = rgb(accent_hex or '0D9488')
        cls.DARK     = rgb(dark_hex   or '1E293B')
        cls.DARKER   = rgb('0F172A')
        cls.TEXT     = cls.DARK
        cls.MUTED    = rgb('64748B')
        cls.FAINT    = rgb('94A3B8')
        cls.LIGHT    = rgb('F8FAFC')
        cls.WHITE    = rgb('FFFFFF')
        cls.LIGHTTXT = rgb('CBD5E1')

SLIDE_W = 13.333; SLIDE_H = 7.5; MARGIN = 0.7
CONTENT_W = SLIDE_W - 2 * MARGIN

def _blank_slide(prs, bg):
    from pptx.enum.shapes import MSO_SHAPE
    sl = prs.slides.add_slide(prs.slide_layouts[6])
    fill = sl.background.fill; fill.solid(); fill.fore_color.rgb = bg
    return sl

def _add_rect(sl, x, y, w, h, color):
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches
    s = sl.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    s.fill.solid(); s.fill.fore_color.rgb = color
    s.line.fill.background(); s.shadow.inherit = False
    return s

def _estimate_lines(text, box_w, font_pt, avg=0.50):
    cw = (font_pt * avg) / 72.0
    cpl = max(1, int(box_w / cw))
    return sum(math.ceil(max(1,len(l))/cpl) for l in text.split('\n'))

def _fit_font(text, bw, bh, start, min_pt=10, ls=1.18):
    pt = start
    while pt > min_pt:
        if _estimate_lines(text, bw, pt) * (pt*ls/72.0) <= bh: break
        pt -= 1
    return pt

def _add_text(sl, text, x, y, w, h, *, size=18, color, font=None, bold=False,
              align=None, anchor=None, autofit=True):
    from pptx.util import Inches, Pt
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR, MSO_AUTO_SIZE
    font = font or BRAND.BODY_FONT
    bx = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = bx.text_frame; tf.word_wrap = True
    if autofit:
        tf.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
        size = _fit_font(text, w, h, size)
    if anchor: tf.vertical_anchor = anchor
    for m in ('margin_left','margin_right','margin_top','margin_bottom'):
        setattr(tf, m, Pt(0))
    p = tf.paragraphs[0]
    if align: p.alignment = align
    run = p.add_run(); run.text = text
    run.font.size = Pt(size); run.font.bold = bold
    run.font.name = font; run.font.color.rgb = color
    return bx

def _set_bullet_xml(paragraph):
    from pptx.oxml.ns import qn
    from pptx.util import Pt
    pPr = paragraph._p.get_or_add_pPr()
    pPr.set('marL', str(int(Pt(0.28*72).emu // 1)))
    pPr.set('indent', str(-int(Pt(0.28*72).emu // 1)))
    bf = pPr.makeelement(qn('a:buFont'), {'typeface': 'Arial'})
    bc = pPr.makeelement(qn('a:buChar'), {'char': '•'})
    pPr.append(bf); pPr.append(bc)

def _add_bullets(sl, items, x, y, w, h, *, size=15, color, gap=10):
    from pptx.util import Inches, Pt
    bx = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = bx.text_frame; tf.word_wrap = True
    for m in ('margin_left','margin_right','margin_top','margin_bottom'):
        setattr(tf, m, Pt(0))
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i==0 else tf.add_paragraph()
        p.space_after = Pt(gap)
        sz = _fit_font(item, w-0.3, h/max(1,len(items)), size)
        run = p.add_run(); run.text = item
        run.font.size = Pt(sz); run.font.name = BRAND.BODY_FONT; run.font.color.rgb = color
        _set_bullet_xml(p)
    return bx

def _title_block(sl, title, kicker=None):
    sq_y = 0.82 if kicker else 0.66
    _add_rect(sl, MARGIN, sq_y, 0.18, 0.18, BRAND.ACCENT)
    if kicker:
        _add_text(sl, kicker.upper(), MARGIN+0.3, 0.5, 11, 0.3,
                  size=11, color=BRAND.ACCENT, bold=True, autofit=False)
    _add_text(sl, title, MARGIN+0.28, (0.74 if kicker else 0.5), CONTENT_W, 0.7,
              size=28, color=BRAND.DARK, font=BRAND.HEAD_FONT, bold=True)

def generate_deck(slides, accent_hex, dark_hex, prs_title):
    from pptx import Presentation
    from pptx.util import Inches
    from pptx.dml.color import RGBColor
    from pptx.chart.data import ChartData
    from pptx.enum.chart import XL_CHART_TYPE
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

    BRAND.init(accent_hex, dark_hex)
    prs = Presentation()
    prs.slide_width = Inches(SLIDE_W); prs.slide_height = Inches(SLIDE_H)

    for s in slides:
        st      = s.get('type','content')
        title   = s.get('title','')
        bullets = s.get('bullets',[])
        subtitle = s.get('subtitle','')

        if st == 'title':
            sl = _blank_slide(prs, BRAND.DARKER)
            _add_rect(sl, 0.9, 1.05, 0.26, 0.26, BRAND.ACCENT)
            _add_text(sl, title, 0.88, 2.25, 11.4, 1.5, size=50,
                      color=BRAND.WHITE, font=BRAND.HEAD_FONT, bold=True)
            if subtitle:
                _add_text(sl, subtitle, 0.9, 3.95, 10.5, 0.7, size=18, color=BRAND.LIGHTTXT)

        elif st == 'section':
            sl = _blank_slide(prs, BRAND.DARK)
            _add_text(sl, '—', 0.85, 2.0, 4.0, 2.2, size=120,
                      color=BRAND.ACCENT, font=BRAND.HEAD_FONT, bold=True, autofit=False)
            _add_rect(sl, 5.1, 2.55, 0.05, 1.7, BRAND.ACCENT)
            _add_text(sl, title, 5.5, 2.7, 7.0, 0.8, size=34,
                      color=BRAND.WHITE, font=BRAND.HEAD_FONT, bold=True)

        elif st == 'close':
            sl = _blank_slide(prs, BRAND.DARKER)
            _add_rect(sl, 0.9, 1.15, 0.26, 0.26, BRAND.ACCENT)
            _add_text(sl, title or 'Questions?', 0.88, 1.6, 11, 1.0, size=44,
                      color=BRAND.WHITE, font=BRAND.HEAD_FONT, bold=True)
            if bullets:
                _add_bullets(sl, bullets, MARGIN+0.3, 3.0, 9.5, 2.2, size=17, color=BRAND.LIGHTTXT)

        elif st == 'image':
            sl = _blank_slide(prs, BRAND.WHITE)
            _title_block(sl, title, kicker='SECTION')
            _add_rect(sl, MARGIN+0.25, 1.85, 5.8, 4.4, RGBColor(0xF1,0xF5,0xF9))
            hint = s.get('imageHint','Add image here')
            _add_text(sl, f'\U0001f4f7  {hint}', MARGIN+0.25, 3.85, 5.8, 0.4,
                      size=12, color=BRAND.MUTED, align=PP_ALIGN.CENTER, autofit=False)
            if bullets:
                _add_bullets(sl, bullets, 7.3, 1.85, 5.3, 4.4, size=15, color=BRAND.TEXT)

        elif st == 'chart':
            sl = _blank_slide(prs, BRAND.WHITE)
            _title_block(sl, title)
            labels = s.get('labels',[]); series = s.get('series',[])
            ct_map = {'bar':XL_CHART_TYPE.COLUMN_CLUSTERED,'barh':XL_CHART_TYPE.BAR_CLUSTERED,
                      'line':XL_CHART_TYPE.LINE,'pie':XL_CHART_TYPE.PIE,'doughnut':XL_CHART_TYPE.DOUGHNUT}
            ct = ct_map.get(s.get('chartType','bar'), XL_CHART_TYPE.COLUMN_CLUSTERED)
            if labels and series:
                cd = ChartData(); cd.categories = labels
                for ser in series:
                    vals = [float(v) if str(v).replace('.','').replace('-','').isdigit() else 0 for v in ser.get('values',[])]
                    cd.add_series(ser.get('name',''), vals)
                chart = sl.shapes.add_chart(ct, Inches(MARGIN), Inches(1.6), Inches(CONTENT_W), Inches(5.0), cd).chart
                chart.has_legend = len(series) > 1
            note = s.get('note','')
            if note: _add_text(sl, note, MARGIN, 6.9, CONTENT_W, 0.3, size=11, color=BRAND.MUTED, autofit=False)

        else:  # content
            sl = _blank_slide(prs, BRAND.WHITE)
            _title_block(sl, title, kicker='SECTION')
            if bullets:
                _add_bullets(sl, bullets, MARGIN+0.25, 1.85, 6.0, 4.6, size=15, color=BRAND.TEXT)

    return prs

def _replace_text_in_shape(shape, new_text):
    if not shape.has_text_frame: return
    from pptx.oxml.ns import qn
    txBody = shape.text_frame._txBody
    all_t = txBody.findall('.//' + qn('a:t'))
    if all_t:
        all_t[0].text = new_text
        for t in all_t[1:]: t.text = ''

def generate_deck_from_template(slides, template_b64):
    """Generate a new deck by cloning slides from a brand template.
    Template slide mapping (by index):
      0 = title/close  (dark background)
      1 = content      (first content slide)
      2 = section      (section divider)
      3 = image        (bullets + image)
      4 = chart
    Falls back to index 1 for unrecognised types.
    """
    from pptx import Presentation
    template_bytes = base64.b64decode(template_b64)
    template_prs = Presentation(io.BytesIO(template_bytes))
    n_tmpl = len(template_prs.slides)

    TYPE_MAP = {
        'title':   min(0, n_tmpl - 1),
        'close':   min(0, n_tmpl - 1),
        'section': min(2, n_tmpl - 1),
        'image':   min(3, n_tmpl - 1),
        'chart':   min(4, n_tmpl - 1),
        'content': min(3, n_tmpl - 1),  # use Bullets slide, not Agenda slide
    }
    DEFAULT_IDX = min(3, n_tmpl - 1)

    prs = Presentation(io.BytesIO(template_bytes))
    original_count = len(prs.slides)

    for slide_data in slides:
        stype   = slide_data.get('type', 'content')
        title   = slide_data.get('title', '')
        bullets = slide_data.get('bullets', [])
        tmpl_idx = TYPE_MAP.get(stype, DEFAULT_IDX)

        new_slide = clone_slide_with_images(prs, tmpl_idx)
        _inject_template_slide(new_slide, title, bullets)

    # Remove original template slides
    xml_slides = prs.slides._sldIdLst
    slides_list = list(xml_slides)
    for i in range(original_count):
        s = slides_list[i]
        r_id = s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        try:
            prs.part.drop_rel(r_id)
        except Exception:
            pass
        xml_slides.remove(s)

    return prs

PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
SKILL_BETAS = ['skills-2025-10-02', 'code-execution-2025-08-25', 'files-api-2025-04-14']
SKILL_TOOLS = [{'type': 'code_execution_20250825', 'name': 'code_execution'}]
SKILL_DEF   = [{'type': 'anthropic', 'skill_id': 'pptx', 'version': 'latest'}]

def _upload_template(client, template_b64):
    """Upload template bytes to Files API, return file_id."""
    import tempfile, os
    tmpl_bytes = base64.b64decode(template_b64)
    with tempfile.NamedTemporaryFile(suffix='.pptx', delete=False) as f:
        f.write(tmpl_bytes); tmp = f.name
    try:
        with open(tmp, 'rb') as f:
            obj = client.beta.files.upload(file=('template.pptx', f, PPTX_MIME))
        return obj.id
    finally:
        os.unlink(tmp)

def _extract_file_id(message):
    """Find file_id of generated pptx in tool result blocks."""
    file_id = None
    for block in message.content:
        t = getattr(block, 'type', '')
        if t in ('code_execution_tool_result', 'bash_code_execution_tool_result'):
            result = getattr(block, 'content', None)
            if getattr(result, 'type', '') in ('code_execution_result', 'bash_code_execution_result'):
                for output in getattr(result, 'content', []) or []:
                    if getattr(output, 'file_id', None):
                        file_id = output.file_id
    return file_id

def generate_with_skill(topic, instructions=None, template_b64=None):
    """Call Anthropic pptx Agent Skill to generate a deck. Returns bytes."""
    import anthropic
    client = anthropic.Anthropic(api_key=os.environ.get('ANTHROPIC_API_KEY'))

    # Use stored template file_id or upload fresh
    template_file_id = os.environ.get('TEMPLATE_FILE_ID')
    if not template_file_id and template_b64:
        template_file_id = _upload_template(client, template_b64)

    prompt = (
        f'Create a brand-new PowerPoint presentation from scratch about:\n{topic}\n\n'
        'There is NO input file and NO template. Do not search for, open, or try '
        'to load any existing .pptx, and do NOT use the template-based editing '
        'workflow — build the slides yourself using the skill\'s from-scratch '
        'creation path. Pick a clean, professional design. Keep each slide '
        'focused, ensure no text overflows its boxes, and save the result as a '
        '.pptx file.'
    )
    if instructions:
        prompt += f'\n\nAdditional instructions:\n{instructions}'

    # Add cache_control to prompt so the skill's repeated system content is cached
    # Cached input is discounted ~90% - biggest cost lever for multi-turn skill loops
    content = [{'type': 'text', 'text': prompt, 'cache_control': {'type': 'ephemeral'}}]
    if template_file_id:
        content.append({'type': 'container_upload', 'file_id': template_file_id})

    betas_with_cache = SKILL_BETAS + ['prompt-caching-2024-07-31']

    # Try streaming first (newer SDK), fall back to create() for older SDK
    try:
        with client.beta.messages.stream(
            model='claude-sonnet-4-6',
            max_tokens=8000,  # reduced from 16000 - fewer output tokens = lower cost
            betas=betas_with_cache,
            container={'skills': SKILL_DEF},
            tools=SKILL_TOOLS,
            messages=[{'role': 'user', 'content': content}]
        ) as stream:
            message = stream.get_final_message()
    except AttributeError:
        message = client.beta.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=8000,
            betas=betas_with_cache,
            container={'skills': SKILL_DEF},
            tools=SKILL_TOOLS,
            messages=[{'role': 'user', 'content': content}]
        )

    out_id = _extract_file_id(message)
    if not out_id:
        txt = ''.join(getattr(b,'text','') for b in message.content if getattr(b,'type','')=='text')
        raise RuntimeError(f'No output file produced. Model: {txt[:400]}')

    downloaded = client.beta.files.download(file_id=out_id)
    return downloaded.read()

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
                slides        = data.get('slides', [])
                accent        = data.get('accent', '475569')
                dark          = data.get('dark',   '1E293B')
                prs_title     = data.get('title', 'Presentation')
                template_b64  = data.get('templateBase64', '')
                if template_b64:
                    # Extract brand colours from template, use them in generate_deck
                    try:
                        from pptx import Presentation as _Prs
                        from pptx.oxml.ns import qn as _qn
                        _tmpl = _Prs(io.BytesIO(base64.b64decode(template_b64)))
                        _theme = _tmpl.slide_master.theme_color_map
                        # Try to get accent1 and dk1 from theme XML
                        _theme_xml = _tmpl.slide_master.part.part_related_by(
                            'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme'
                        )._element
                        def _hex(el, tag):
                            n = el.find('.//' + _qn(tag))
                            if n is not None:
                                clr = n.find(_qn('a:srgbClr'))
                                if clr is not None: return clr.get('val','')
                            return ''
                        tmpl_accent = _hex(_theme_xml, 'a:accent1') or accent
                        tmpl_dark   = _hex(_theme_xml, 'a:dk2')     or _hex(_theme_xml, 'a:dk1') or dark
                        # Also scan slide shapes for most common background colour
                        for sl in _tmpl.slides[:3]:
                            for sh in sl.shapes:
                                try:
                                    rgb = sh.fill.fore_color.rgb
                                    val = str(rgb)
                                    # If it looks like a dark background colour use it
                                    if int(val[:2],16) < 50 and int(val[2:4],16) < 50:
                                        tmpl_dark = val
                                        break
                                except: pass
                        prs = generate_deck(slides, tmpl_accent, tmpl_dark, prs_title)
                    except Exception as _e:
                        prs = generate_deck(slides, accent, dark, prs_title)
                else:
                    prs = generate_deck(slides, accent, dark, prs_title)
            elif action == 'generate_ai':
                # Use Anthropic pptx Agent Skill for high-quality generation
                topic        = data.get('topic', '')
                instructions = data.get('instructions')
                template_b64 = data.get('templateBase64', '')
                if not topic:
                    self._error(400, 'Missing topic')
                    return
                pptx_bytes = generate_with_skill(topic, instructions, template_b64)
                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
                self.send_header('Content-Disposition', 'attachment; filename="presentation.pptx"')
                self.send_header('Content-Length', str(len(pptx_bytes)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(pptx_bytes)
                return

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
