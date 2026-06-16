# Breeze HR — design system refresh

Goal: make the app stop looking like a default Tailwind/AI template and start looking
like a deliberate, professional HR product. The look should read calm, trustworthy and
dense-but-clear — closer to Linear, Vanta or Lattice than to a starter kit.

## How to use this

Do NOT restyle pages one by one. The "AI look" comes from a small set of decisions that
repeat everywhere. Fix them once at the source:

1. First, map the codebase: find the theme/Tailwind config and the shared components
   (Button, Badge/Tag, Card, Tabs, Table, Modal/Dialog, Input, EmptyState, KPI/StatCard,
   Dropzone, ProgressBar, Avatar). List them before editing.
2. Change the tokens in the config and the shared components so the whole app moves at once.
3. Only after that, grep for one-off inline styles that bypass the shared components
   (hardcoded `bg-blue-600`, `border-dashed`, `rounded-2xl`, hex colours) and fix the stragglers.
4. Detect the stack and adapt — class names below are illustrative, not literal.

## North star (the five rules everything follows)

1. One accent, used sparingly. Monochrome does the heavy lifting; colour appears on roughly
   5% of any screen and only where it means something.
2. Primary buttons are near-black, not blue. One primary button per view; everything else
   is secondary or ghost.
3. No dashed boxes anywhere. Whitespace and hairlines do the framing.
4. Calm corners. ~6–8px radius. No pills except real toggles/segmented controls and status dots.
5. Real type hierarchy. Big confident headings, small muted labels, two or three weights only.

## Tokens (replace the current ones)

Colour — base is monochrome:

- `--ink` #16181D            (primary text, primary buttons)
- `--surface` #FFFFFF        (cards, panels)
- `--bg` #FAFAF9             (page background — a warm off-white, not pure grey)
- `--text-secondary` #6B6F76
- `--text-tertiary` #9AA0A6
- `--border` rgba(0,0,0,0.10)  (hairlines — 1px, never dashed)

One accent (swap for your brand colour, but keep it desaturated — NOT #2563EB):

- `--accent` #2A4A6B         (deep, calm blue-slate — used for active states + links only)
- `--accent-soft` #EEF2F6    (accent background for selected rows / soft tags)

Status — muted, semantic only. Never use these as decoration:

- success #15803D  / soft bg #F0FAF3
- warning #B45309  / soft bg #FBF3E6
- danger  #B42318  / soft bg #FCF0EF  (reserve for genuinely destructive actions)

Radius: `sm` 4px · `md` 6px (default) · `lg` 8px (cards). Kill anything ≥12px.

Shadows: remove almost all. Separate elements with hairline borders and whitespace.
The only allowed shadow is a faint focus ring on inputs.

Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48. Use only these values. Increase padding
generally — the app is currently cramped in places and floaty in others.

Typography:
- Keep Inter if you like, but tune it: tighten heading tracking to about -0.015em and lean
  on size + colour for hierarchy, not just bold. (A characterful alternative: Geist or
  General Sans for UI.)
- Weights: 400 body, 500 medium for labels/headers, 600 only for page titles.
- Numbers in tables and KPIs: use tabular figures (`font-variant-numeric: tabular-nums`).
- Sentence case everywhere. Micro-labels (field labels, column heads) may be uppercase
  ONLY if tracked (+0.04em) and in `--text-tertiary`, applied consistently.

## Components

### Buttons — three tiers, no colour-coding by function
- Primary: solid `--ink` bg, white text, 6px radius, weight 500. One per view.
- Secondary: transparent bg, 1px `--border`, `--ink` text, optional leading icon.
- Ghost: text only, `--text-secondary`, hover adds a subtle bg.
- Destructive (Delete): ghost by default in `--text-secondary`; turn `danger` only on
  hover or in a confirm step. Do not paint every Delete red at rest.
- Replace ALL of these with the tiers above: solid-blue "Generate", "+ Add record", "Log",
  "Checklist"; green-outline "Export"; blue-outline "Guidance"; white "Details"; red "Delete".
  Buttons should differ by weight/prominence, never by hue.

### Tabs / segmented controls (Trackers nav, and toggles generally)
Two acceptable patterns, pick one and use it everywhere:
- Underline tabs: text labels, active tab marked by a 2px underline in `--ink` and `--ink`
  text; inactive tabs `--text-secondary`. (Preferred for top-level nav like the Trackers row.)
- Segmented control: a subtle `--bg` track, the active segment a white card with `--ink`
  text and a barely-there shadow. Use for on/off and small option switches.
Replace the blue filled pill tab and the blue "+ Custom" text. "+ Custom" becomes a
secondary or ghost button aligned to the right.
Toggle switches: grey track when off, `--ink` (or `--accent`) when on. One switch style app-wide.

### KPI / stat cards (Trackers top row) — single biggest upgrade
- Remove shadows; use a hairline border or a flat `--bg` surface with no border.
- Numbers are `--ink`, NOT pink/blue/green/red. The rainbow numbers are the loudest AI tell here.
- Layout: small `--text-tertiary` label on top, large number below, muted caption under that.
- Colour only enters when a number signals a problem — e.g. "2 missing dependant" may get a
  small `warning` dot. Everything healthy stays monochrome.

### Badges / tags / status — one consistent system
- Type tags (Shared Parental, maternity): neutral soft tag — `--bg` fill, `--text-secondary`
  text, 4px radius, 11px. No amber.
- Status (Upcoming, Active, On leave): a small coloured dot + label. The dot colour encodes
  state with muted status colours; the label stays `--text-secondary`. No filled blue pills.
- KEY: a quiet 1px outline tag in `--text-tertiary`, not a yellow fill.
- Same radius, same size, same padding for every tag in the app.

### Empty states (dev plan) — no dashed box
Icon in a soft circle, a heading, one tight line of copy, one primary button — framed by
whitespace and at most a single hairline divider above. Tighten the copy: lead with the action.

### Dropzones (Compare documents)
- Replace the heavy default dashed rectangles with a calm drop area: 1px `--border` (a fine
  dash is acceptable here since drop zones conventionally read as dashed — but make it 1px and
  subtle, not the chunky default), 8px radius, faint `--bg` fill, centred icon + label.
- Delete the three outline "chip" descriptors ("Good for…", "Both files should be…",
  "Excel: compares…"). They look like disabled inputs. Make them plain muted helper text lines.

### Tables (Family Leave list)
- Drop the heavy dark-navy header bar with rounded corners. Use a plain header row on the page
  background: small uppercase-tracked `--text-tertiary` column labels, a bottom hairline, no fill.
- Row separators are hairlines, not boxes. Add comfortable row padding.
- Right-align numeric columns; use tabular figures.

### Modal / detail panel (Sarah Mitchell)
- Replace the full navy header block with a white header: `--ink` title, hairline bottom border,
  a ghost icon close button. If you want a colour cue, use a thin 3px accent strip, not a slab.
- Collapse the stacked grey rounded panels into one rhythm: sections separated by hairlines and
  whitespace. The "MATB1 received…" note becomes a subtle left-border callout (border-radius 0 on
  that single-sided border) or just muted text under a label — not another grey rounded box.
- One input style: white or very subtle fill, 1px `--border`, 6px radius, consistent label
  treatment. The uppercase field labels are fine if tracked and tertiary-coloured everywhere.

### Avatars
Add initials-circle avatars wherever people appear — the dev-plan list, table rows, the modal
header. Even uniform neutral circles instantly read as a real product. Tint by team if you want.

### Progress bars
Thinner track, `--ink` or `--accent` fill (not blue), muted `--bg` track, rounded ends.

## Copy
Active voice, sentence case, no filler. Buttons say what happens ("Generate plan", not
"Generate development plan" if space is tight). Empty states invite an action rather than
describe a void. Errors state what to do next; they don't apologise.

## Per-screen checklist (sanity check after the system change)

Development plans: blue buttons → ink primary + outline secondary · dashed empty state gone ·
KEY/Star tags quieted · avatars added · header given a real title with the caption demoted to subtitle.

Trackers: pill tabs → underline tabs · rainbow KPI numbers → ink · green success banner softened ·
navy table header → hairline header · Export/Guidance/Add unified into the button tiers · status
badges → dot + label.

Detail modal: navy header → white header + hairline · stacked grey panels collapsed · inputs unified ·
contact-log container de-boxed.

Compare documents: descriptor chips → muted helper text · dropzones calmed · Reset → secondary button.
