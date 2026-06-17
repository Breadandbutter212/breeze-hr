# Breeze Autofill (extension MVP)

A companion browser extension that pre-fills an employee's details from Breeze HR
into any onboarding or screening portal — including ones with **no API** (e.g.
Credence). It does **not** log into portals or store their passwords: you're
already logged in, and the extension just fills the form on the page you're
viewing.

## How it works

```
Breeze app  ──postMessage──►  bridge.js  ──►  chrome.storage  ──►  popup
(click "Autofill" on a       (runs only on                         "Fill this page"
 candidate)                   Breeze pages)                         ▼
                                                          autofill engine fills the
                                                          portal form by matching
                                                          field labels/types
```

- **Generic autofill** — matches fields by `type`, `autocomplete`, `name`, `id`,
  `placeholder`, `aria-label` and the nearby `<label>`. Works on portals it has
  never seen, for the common fields (name, email, phone, job title…).
- **Sensitive fields** (salary, DOB, NI number) only fill when you tick the box.
- **Copy buttons** — anything autofill can't place, click to copy and paste in.
- **Never overwrites** a field that already has a value.

## Install (unpacked, for testing)

1. Chrome/Edge → `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. (For local testing of the Breeze bridge while opening `app.html` as a file)
   click the extension's **Details** → enable **Allow access to file URLs**.

## Try it in 60 seconds

1. Open `extension/test-form.html` in the browser.
2. Click the **Breeze Autofill** toolbar icon → **+ Add / edit an employee
   manually** → fill a few fields → **Save**.
3. Back on the test form, open the popup → **Fill this page**. (Tick *Include
   sensitive* to also fill DOB / NI / address.)

## Try the Breeze hand-off

1. Open the Breeze app, go to **Recruitment → Candidate Pipeline**, and click
   **Autofill** on a candidate card. A toast confirms it was sent.
2. Open the extension popup — that employee is now the active profile.
3. Go to the portal (or `test-form.html`) → **Fill this page**.

## Notes / limits

- The field map is heuristic. If a portal uses unusual labels, some fields won't
  match — use the Copy buttons for those, or we add a small per-portal override
  later.
- Today the Breeze app pushes the candidate's **name and job title** (the demo
  pipeline cards don't carry email/salary). Real onboarding records would carry
  the full profile; you can also fill the rest in the popup's manual editor to
  test end-to-end.
- This is an MVP to test usefulness, not a store-published build (no icons, no
  packaging).
