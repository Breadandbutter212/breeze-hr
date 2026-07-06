# Code Execution vs Converter - Experiment Results

Standalone test of Anthropic's **code execution tool** (Claude builds a `.docx` natively with
`python-docx` in a sandbox) as a potential premium document path, vs Breeze's **current converter**
(`api/_docx-render.mjs`, which turns model Markdown into a `.docx`). Nothing outside this folder is touched.

**Status: harness built and the converter side has run. The code-execution side has NOT run yet -
there is no `ANTHROPIC_API_KEY` available locally (not in the shell, not in `.env` - which only holds
Composio/Merge/Supabase keys). Set the key and run `node run.mjs full` to complete Steps 2-3.**

---

## STEP 0 - What the current docs say (fetched 2026-07-02, live)

From `platform.claude.com` (code-execution-tool + files docs) and the Anthropic API reference:

| Thing | Current value |
|---|---|
| Code execution tool type | `code_execution_20250825` (broad, used here), also `code_execution_20260120` / `code_execution_20260521` (REPL persistence + PTC; Sonnet 4.5+/Opus 4.5+) |
| Beta header (code exec) | `code-execution-2025-08-25` |
| Beta header (Files API) | `files-api-2025-04-14` |
| Model used | `claude-sonnet-4-6` - supports all three tool versions |
| Container | 1 CPU / ~5 GiB RAM / 5 GiB disk, **no internet**, Python 3.11; `python-docx`, `openpyxl`, `python-pptx`, `matplotlib`, `pillow`, `pypdf` pre-installed. 90s wall-clock per cell. Reusable via `response.container.id`. |
| Result blocks | `code_execution_tool_result` -> `.content` (`bash_code_execution_result`) -> `.content[]` items carry `.file_id` for created files |
| Download | `client.beta.files.download(file_id)` -> `arrayBuffer()`; **only** code-exec/skill-created files are downloadable (not user uploads) |
| Cost | Code exec is **free when web_search/web_fetch is in the request**; otherwise $0.05/container-hour after 1,550 free hours/org/month. Tokens billed normally. |
| Gotcha | Code exec is **not** ZDR-eligible. Files API ~100 req/min during beta, 500 MB/file. |

If the first `full` call returns a 403/permission or "beta not enabled" error, that is the Console
step: enable the **Code execution tool** and **Files API** betas for the workspace/org that owns the key.

---

## STEP 1 - The harness

| File | Role |
|---|---|
| `cases.mjs` | 3 test cases. Each has a `docPrompt` (shared verbatim by both paths, so the **model is held constant** and the only variable is the rendering path) and an `offlineDraft` (for the no-key converter run). |
| `codeexec.mjs` | Calls Claude with the code execution tool, walks the response for generated `file_id`s, downloads them to `output/`. Handles the `pause_turn` server-tool loop. |
| `converter.mjs` | Imports the app's real current renderer `renderDocx` from `../../api/_docx-render.mjs` **read-only**. In `full` mode it asks the same model for Markdown, then renders it - exactly the app's real flow. |
| `run.mjs` | Orchestrator + budget guards. `node run.mjs offline` (no key) or `node run.mjs full` (needs key). |

> Note on "replicate `textToDocxBuffer`": that function was replaced in the app by `renderDocx`
> (`api/_docx-render.mjs`). The converter side imports the **current** renderer, so this compares
> against what the app actually ships today, not the retired code.

**Budget guards (Sonnet $3/M in, $15/M out):** hard total cap ~$2 (aborts before exceeding), per-request
soft warn ~$0.50, `maxRetries=1`, and first-call auth/beta failure **stops** (no token-burning loop).
`max_tokens` capped at 8k (code exec) / 4k (converter), so worst-case per request is ~$0.12.

### How to run
```bash
cd experiments/codeexec-test
export ANTHROPIC_API_KEY=sk-ant-...      # same var the app uses
node run.mjs full                         # writes .docx pairs to output/ + _run-summary.json
```

---

## STEP 2 - Results table

| Test case | codeexec cost | codeexec time | tokens (in/out) | converter cost | notes |
|---|---|---|---|---|---|
| A - Probation letter | _pending key_ | _pending_ | _pending_ | _pending_ | offline converter draft rendered (see below) |
| B - Hybrid policy one-pager | _pending key_ | _pending_ | _pending_ | _pending_ | the hard case: table + callout + cover + footer |
| C - Probation scorecard | _pending key_ | _pending_ | _pending_ | _pending_ | 5-row scoring table, merged header, zebra |

(Values fill in automatically from `output/_run-summary.json` after `node run.mjs full`.)

**Rough cost expectation:** each code-exec case is ~1-2k input + ~3-8k output tokens plus a few
model turns while the sandbox runs - on the order of **$0.05-$0.20 per document**, well under the
$0.50/request cap. Whole experiment should land **~$0.30-$0.60**, under the $2 ceiling. Container
time is negligible (well inside the free tier).

---

## STEP 3 - Assessment

### Converter side (RAN, offline drafts -> `renderDocx` -> `.docx`, inspected structurally)

I can't render to an image locally (no LibreOffice), so this is a WordprocessingML structural read of
the three `output/*-converter.docx` files:

| Case | Paragraphs | Real Word tables | Shaded cells | Navy accent | Header white text |
|---|---|---|---|---|---|
| A letter | 28 | 0 (correct - it's a letter) | 0 | yes (headings) | - |
| B policy | 36 | 1 (6 rows) | 19 (navy header + zebra) | yes | yes |
| C scorecard | 27 | 1 (6 rows) | 18 (navy header + zebra) | yes | yes |

**Honest read:** the current converter is genuinely decent, not the strawman it might seem. It emits
**real Word tables** with a navy header row, white bold header text, zebra striping and cell borders;
styled title + section headings; bold runs; bullets/numbered lists. For B and C the tabular content
comes out clean and on-brand.

**Where it hits its ceiling** (structural, inherent to a Markdown->docx mapper with one fixed house style):
- No true page layout - no cover block, no header/footer, no columns, no letterhead design. Case B's
  "footer line" becomes just another paragraph; Case A's "letterhead feel" is plain stacked text.
- One fixed visual theme; can't reinterpret "make it look like a designed one-pager".
- Tables are grid-only: colspan works, but not merged header cells spanning sub-columns, nested tables,
  or per-cell layout.
- Bound to Word's rendering model - a "Word look", not a designed-document look.

### Code-execution side (NOT RUN - needs the key)

Cannot give a visual/structural verdict yet. What to look for when it runs (and why the hypothesis is
plausible): `python-docx` lets Claude set section headers/footers, page geometry, true table styles,
merged cells (`cell.merge`), run-level colour/spacing, and a cover block - i.e. the exact things the
converter structurally cannot do. Expected outcome: **codeexec clearly ahead on B (layout-heavy) and on
letterhead/footer polish; roughly even with the converter on C's plain table; both fine on A's text.**
This will be confirmed, not assumed, once the pairs are opened in Word.

### Beta limitations to watch (from docs; confirm empirically on the run)
- Container has **no internet** - fine here (no fonts/logos fetched); a branded template would need to
  be uploaded via `container_upload`.
- 90s per-cell limit - irrelevant for a single doc build.
- Files API ~100 req/min beta cap; code exec **not ZDR-eligible** (matters if Breeze commits to ZDR).
- Extra latency vs the converter: a sandbox spin-up + model writing/running Python is seconds, not
  milliseconds - acceptable for a "premium/polish" action, not for every download.

---

## Recommendation (preliminary - pending the visual run)

**Worth prototyping as a *premium* path, not a replacement.** The converter is good enough for
everyday, editable HR docs (letters, simple policies, scorecards) and is instant and free. Code
execution is the right tool specifically when the ask is **"make this look designed"** - one-pagers,
branded packs, anything with cover/header/footer/merged-cell layout - where the converter structurally
can't reach.

### How it would slot in alongside `api/generate-doc.js` (sketch, not built)
- Add a `premium: true` (or `style: "designed"`) flag on the `/api/generate-doc` request.
- When set, instead of `renderDocx(plainText)`, call Claude with the code execution tool + Files API,
  download the produced `.docx`, and stream it back with the same `Content-Disposition` the endpoint
  already uses. Everything else (auth, rate limiting) is unchanged.
- **House-style / policy context:** pass the brand guidance as the system prompt (as `HOUSE_STYLE`
  here). For real letterhead/logo, upload a template `.docx` once via the Files API and reference it
  with a `container_upload` block so Claude edits the branded template rather than building from blank.
- **Fallback (critical):** if the beta call errors (403/beta-not-enabled, rate limit, timeout) or
  returns no file, fall back to the existing `renderDocx` path and return that `.docx`. The app already
  degrades to `.txt` on failure; this just inserts converter-docx as the middle tier:
  `codeexec (premium) -> renderDocx (standard) -> .txt (last resort)`.
- **Cost control:** Sonnet, cap `max_tokens`, gate behind the premium flag so it's opt-in per document,
  not on every download. Consider caching the branded-template file_id.

### To finish this experiment
Set `ANTHROPIC_API_KEY` and run `node run.mjs full`, then open each `output/<case>-codeexec.docx` next
to `output/<case>-converter.docx` in Word. This table's numbers and the visual verdict fill in from
`_run-summary.json` + your own eyeball. If the first call 403s on the beta, enable Code Execution +
Files API in the Console for that key's workspace and re-run.
