from http.server import BaseHTTPRequestHandler
import json
import base64
import io
import copy

def apply_ops(prs, ops):
    from pptx.util import Pt
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

            # Find a layout with both a title and a body content placeholder
            target_layout = prs.slide_layouts[1]
            for layout in prs.slide_layouts:
                has_title = any(
                    ph.placeholder_format.type in TITLE_TYPES
                    for ph in layout.placeholders
                )
                has_body = any(ph.placeholder_format.idx == 1 for ph in layout.placeholders)
                if has_title and has_body:
                    target_layout = layout
                    break

            new_slide = prs.slides.add_slide(target_layout)

            for ph in new_slide.placeholders:
                ph_type = ph.placeholder_format.type
                ph_idx  = ph.placeholder_format.idx
                if ph_type in TITLE_TYPES:
                    ph.text = title_text
                elif ph_idx == 1 and bullets:
                    tf = ph.text_frame
                    tf.clear()
                    for i, bullet in enumerate(bullets):
                        if i == 0:
                            tf.paragraphs[0].text = bullet
                        else:
                            p = tf.add_paragraph()
                            p.text = bullet
                            p.level = 0

            # Move new slide to correct position (add_slide always appends)
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
