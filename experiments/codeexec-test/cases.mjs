// Test cases for the code-execution vs converter experiment.
//
// Each case has:
//   docPrompt    - the content request, shared VERBATIM by both paths (holds the model constant,
//                  so the only variable is the rendering path: python-docx vs our converter).
//   offlineDraft - a representative Markdown draft in the canonical format our converter
//                  (api/_docx-render.mjs) understands, so the converter side can be generated
//                  and inspected WITHOUT an API key.
//   accent       - brand accent passed to our converter.

// Shared brand/house-style guidance. Both paths get the same brand intent; only the mechanism differs.
export const HOUSE_STYLE = `Breeze HR house style:
- Clean, professional, "top HR consultancy" look. Navy (#1F3864) headings/accents on white.
- Arial / Helvetica, ~10-11pt body. Clear hierarchy: styled title, section headings, generous spacing.
- Tables: navy header row with white bold text, light zebra striping on data rows, thin grey cell borders.
- Never use em dashes; use a single hyphen "-". No emoji. UK English.`;

export const CASES = [
  {
    id: 'A-probation-letter',
    title: 'Probation confirmation letter',
    accent: 'navy',
    docPrompt:
`Write a probation confirmation letter for Sarah Jones, Marketing Executive, who started on 5 January 2026 and has successfully passed her six-month probationary period. Confirm her employment is now permanent. Professional letterhead feel with a company block at the top (use "Breeze HR Ltd, 1 King Street, London EC1A 1AA"), today's date, a formal salutation, 3-4 short paragraphs, and a signature block for "Emma Thompson, Head of People". Navy headings/accents.`,
    offlineDraft:
`# Breeze HR Ltd
1 King Street, London EC1A 1AA

2 July 2026

**Private and confidential**

Sarah Jones
Marketing Executive

Dear Sarah

## Confirmation of successful probation

I am pleased to confirm that you have successfully completed your six-month probationary period, which began on 5 January 2026. Following review of your performance, your employment with Breeze HR Ltd is now confirmed on a permanent basis.

Throughout your probation you have consistently met the standards expected of a Marketing Executive, and your contribution to the team has been valued. No further probationary conditions apply.

All terms of your existing contract of employment continue unchanged, including your notice period, which increases in line with your contract now that you are a permanent employee.

Thank you for your commitment during your first six months. We look forward to your continued success at Breeze HR.

Yours sincerely

**Emma Thompson**
Head of People
Breeze HR Ltd`,
  },

  {
    id: 'B-hybrid-policy',
    title: 'Hybrid Working Policy one-pager',
    accent: 'navy',
    docPrompt:
`Create a polished two-page "Hybrid Working Policy" one-pager. Include: a cover-style header with the title and a metadata strip (Version 1.0 | Owner: People Team | Effective: 1 August 2026 | Review: August 2027); a short purpose paragraph; a comparison TABLE contrasting Office expectations vs Remote expectations across rows for Core hours, Availability, Meetings, Equipment, and Data security; a highlighted CALLOUT box for the key rules (minimum 2 days/week in office, manager approval for full-remote, no confidential work in public spaces); and a footer line ("Breeze HR Ltd - Hybrid Working Policy - Page 1"). Make it look like a designed one-pager.`,
    offlineDraft:
`# Hybrid Working Policy
Version 1.0 | Owner: People Team | Effective: 1 August 2026 | Review: August 2027

## Purpose
This policy sets out how hybrid working operates at Breeze HR Ltd. It balances the flexibility of remote work with the collaboration and culture benefits of time in the office, and applies to all employees whose roles are suitable for hybrid working.

## Office vs remote expectations

| Area | Office expectations | Remote expectations |
| --- | --- | --- |
| Core hours | On site 10:00-16:00 on office days | Available and contactable 10:00-16:00 |
| Availability | Present at your desk or in meetings | Online on Teams, calendar kept current |
| Meetings | Attend team meetings in person | Join by video with camera on |
| Equipment | Company desk setup provided | Employee ensures safe, private workspace |
| Data security | Clear-desk policy at end of day | No confidential work in public spaces |

> Key rules: a minimum of 2 days per week in the office; full-remote arrangements require written manager approval; confidential or personal data must never be worked on in public spaces or on unsecured networks.

## Requesting a change
Employees who wish to change their hybrid pattern should speak to their line manager, who will consider the request against business and team needs. Approved patterns are reviewed every six months.

---
Breeze HR Ltd - Hybrid Working Policy - Page 1`,
  },

  {
    id: 'C-probation-scorecard',
    title: 'Probation review scorecard',
    accent: 'navy',
    docPrompt:
`Produce a short probation review summary document for Sarah Jones (Marketing Executive). Include a brief overview line, then a scoring TABLE with a header row and five criteria rows: Quality of work, Reliability, Team working, Communication, and Initiative. Columns: Criterion, Rating (1-5), Comments. Give realistic ratings (mostly 4-5) and one-line comments. Use a navy header row and zebra striping on the data rows. End with an overall recommendation line: "Recommendation: Confirm employment".`,
    offlineDraft:
`# Probation Review Summary
Employee: Sarah Jones | Role: Marketing Executive | Review date: 2 July 2026

Overview: Sarah has performed strongly across her six-month probation, meeting or exceeding expectations in all core areas.

| Criterion | Rating (1-5) | Comments |
| --- | --- | --- |
| Quality of work | 5 | Consistently high standard, little rework needed |
| Reliability | 4 | Dependable, meets deadlines, occasional early finish |
| Team working | 5 | Supportive, collaborates well across functions |
| Communication | 4 | Clear and professional with clients and colleagues |
| Initiative | 4 | Proactively proposed two campaign improvements |

**Recommendation: Confirm employment**`,
  },
];
