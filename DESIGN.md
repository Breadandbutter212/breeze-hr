# Breeze HR — design system

Direction: friendly modern HRIS. Warm, rounded, people-first — think Humaans / Lattice,
not a starter template. Navy gives structure and trust; coral makes it warm and human.

## How to use this

Do NOT restyle pages one by one. The look comes from a small set of decisions that repeat
everywhere. Apply them once at the source:

1. Map the codebase first: find the theme/Tailwind config and the shared components
   (Sidebar, Button, Badge/Tag, Card, StatCard/KPI, Tabs, Table, Modal, Input, Checkbox,
   ProgressBar/Ring, EmptyState, Dropzone, Avatar, Chart).
2. Change the tokens in the config and the shared components so the whole app moves at once.
3. Then grep for one-off styles that bypassed the components (hardcoded `bg-blue-600`,
   any purple, `border-dashed`, `rounded-2xl`, emoji, raw hex) and fix the stragglers.
4. Visual changes only — never change how anything works.

## Brand in one line

Navy structure + a single warm coral accent + friendly rounded type. Colour is used to guide
the eye, never to decorate. If a colour isn't carrying meaning, it's a neutral grey.

## Tokens

Typeface: Plus Jakarta Sans (load from Google Fonts), weights 400 / 500 / 600 / 700.
Set it as the base font everywhere. Tighten heading letter-spacing to about -0.01em.
Numbers in stats and tables use tabular figures.

Colour:
- Navy (structure)        #2E3D52   sidebar, headings, primary text on light
- Coral (accent)          #D85A30   primary buttons, active nav, progress, key highlights
- Coral soft (fills)      #FAECE7   tags, active/completed tints
- Coral text-on-tint      #993C1D   text/icons sitting on coral-soft
- Page background         #FBFAF8   warm off-white
- Surface                 #FFFFFF   cards, panels
- Text secondary          #6B6F76
- Text tertiary           #9AA0A6
- Hairline border         rgba(0,0,0,0.08)

Meaning-only (never decoration):
- Amber (warning)  #BA7517 / soft #FAEEDA   overdue, urgent
- Green (success)  #15803D / soft #F0FAF3   done, on track

Charts only (the donut and graphs — this set appears nowhere else in the UI):
  navy #2E3D52 · coral #D85A30 · teal #1D9E75 · amber #BA7517

Radius: inputs/buttons/chips 10px · cards 16px. Pills only for toggles and status dots.
Shadows: none heavy. Hairline borders separate things; one very soft shadow on the dashboard
hero card is the only exception. Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48.

## Components

Sidebar: navy #2E3D52, white labels, muted labels for inactive items. The active item is a
coral fill with white text. Replace any purple highlight.

Buttons — three tiers, differ by prominence not by hue:
- Primary: solid coral, white text, 10px radius, weight 600. One per view.
- Secondary: white/transparent, hairline border, navy text, optional leading icon.
- Ghost: text only, secondary grey, subtle hover fill.
- Delete: ghost in secondary grey by default; turns coral/danger only on hover or confirm.
  Replace every default-blue button and every plain-red Delete with these.

Checkboxes / toggles / progress: coral when on/active/filled. Progress bars and rings are
coral on a light track. Completed or active items get a faint coral-soft background tint so
finishing something feels rewarding.

Tags / badges — one rule: only genuinely important tags carry colour (e.g. "Legal requirement"
uses coral-soft), everything else is a neutral grey soft tag. Same radius (10px), size and
padding for every tag. Status (Upcoming, Active, On leave) is a small coloured dot + a grey
label, not a filled pill.

StatCard / KPI: white surface, hairline border, big number in navy, small muted label. Numbers
are navy, never a rainbow. A single highlighted metric (e.g. "time saved") may use the coral-soft
tint with coral text. Colour enters only when a number signals a problem (e.g. an amber dot).

Icons: replace every emoji with a single outline icon set (Lucide or Tabler), one weight, one
size. Use meaningful ones: ti-git-compare for compare, ti-calendar for dates, ti-clock for
timing, ti-user for people.

Empty states: icon + heading + one tight line + one coral button, framed by whitespace and at
most one hairline rule. No dashed boxes anywhere.

Dropzones: calm 1px border (a fine dash is fine here since drop areas read as dashed — 1px,
subtle, not the chunky default), 16px radius, faint fill, centred icon + label. No descriptor
"chip" rows — fold that into one helper line.

Tables: plain header row on the page background with small tracked grey column labels and a
bottom hairline — not a heavy navy slab. Rows separated by hairlines, comfortable padding,
numeric columns right-aligned with tabular figures.

Modal / detail panel: white header with navy title and a hairline bottom border; close is a
ghost icon. Collapse stacked grey panels into hairline-separated sections. One input style:
white fill, hairline border, 10px radius, consistent label treatment.

Avatars: initials circles wherever people appear (lists, table rows, modal headers).

## Per-screen treatment

Dashboard: friendly greeting, then a hero card with a coral progress ring ("21 active items")
and the chart donut using the four chart colours. KPI row below in white hairline cards, navy
numbers, the "time saved" card in coral-soft. Retire all purple.

Checklist (leave detail): the 50% block becomes a coral progress ring. Checkboxes coral,
completed steps get the faint coral tint. Tags follow the one-colour rule (legal = coral,
recommended/policy = neutral). Emoji become icons. Schedule is the coral primary; Close is a
ghost; Delete is ghost.

Compare documents: two upload slots side by side with a circular ti-git-compare badge between
them. Each slot is a clean white card with the file icon in a round chip — original in a light
coral-soft chip, updated in a solid coral chip with a white icon. Remove the grey descriptor
chips; replace with one helper line. Coral "Compare documents" button centred below.

Trackers: KPI numbers in navy (not pink/blue/green/red). Pill tabs become underline tabs with
a coral active underline. Status badges become dot + label. Export / Guidance / Add record
unify into the button tiers. The navy table header becomes a hairline header.

## Copy

Active voice, sentence case, no filler. Buttons say what happens. Empty states invite an action.
Errors say what to do next.