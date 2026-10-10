# Runbook: forms and search usability

NFR-U1 (WCAG 2.2 AA), NFR-P1 (performance), audit findings UX-02, UX-06, PERF-01, PERF-02 and A11Y-01 to A11Y-03 (unit U58).

## 1. Combobox (`components/forms/combobox-field.tsx`, `lib/combobox.ts`)

The WAI-ARIA 1.2 editable combobox with a list popup. The field names and the codes it submits are unchanged, so every form and server action keeps working.

- Opens on click, tap, the chevron button and ArrowDown. Typing filters the whole list. A click or tap on an option, or Enter on the highlighted one, chooses it.
- The list is only in the page while it is open and holds at most `COMBOBOX_LIMIT` (50) options. When more match, a line under the list says "Showing 50 of N. Type to narrow the list." and a polite live region announces the count ("N results available, 50 are listed. Type to narrow the list.", "No match" for none).
- Keys: ArrowDown and ArrowUp open the list and move the highlight (it stops at the ends); Home and End move to the first and last option once an arrow key has been used (before that they move the text cursor); Enter chooses the highlighted option (and does nothing special when none is highlighted, so a form still submits); Escape closes and drops the typed text; Tab or any blur closes and drops the typed text, the chosen value stays. `aria-activedescendant` names the highlighted option and `aria-controls` the list while it is open.
- A click opens the list with no option highlighted, or with the chosen one, so an Enter on a form field does not pick the first option by accident. When the chosen option lies beyond the first 50, the list starts at it (or as far down as still fills 50 rows), so the current choice is always listed and highlighted. `aria-expanded` is true only while a list is in the page (free-text mode with no suggestion left has none).
- Targets: the chevron is a 44 by 44 px button (`tabindex="-1"`, the field itself is the one tab stop) and every option is at least 44 px high. The list is absolutely positioned, so opening it moves nothing.
- Free-text mode (skills) keeps its meaning: the value is the typed text and the options are suggestions.

## 2. Vacancy search (`/[lang]/jobs`)

Keyword, country and the Search button stay visible. The other nine controls (city, occupation, industry, employment type, recruitment, the three salary fields, accommodation, visa support) are in the "Filters" group: open at 1024 px and wider, where the form is a column beside the results; below that a "Filters" button (`aria-expanded`, `aria-controls`) opens it and a second submit button, "Show results", ends it. A submit that the form refuses because of a field in the closed group opens the group, so the message can be seen. Active filters are chips (`components/jobs/active-filters.tsx`, `lib/jobs/filter-chips.ts`): each is a link to the same search without that filter (the minimum salary goes with its currency and pay period), at least 44 px high, working without JavaScript. The query parameters and the server-side search are unchanged.

## 3. Stage filter

`components/applications/stage-filter.tsx` is a server component: a GET form with the select and an "Apply filter" button, and the other parameters of the address (vacancy, sort, direction, view) as hidden fields. Choosing a stage changes nothing by itself (WCAG 3.2.2); Apply loads the first page of that stage. It works without JavaScript. "All stages" gives `?stage=` which every list reads as no filter.

## 4. Other fixes

A single-line checkbox row is at least 44 px high (`min-h-11` on `CheckboxRow`). The stacked applicant table on a phone keeps `role` table, rowgroup, row, columnheader and cell, as the documents table does.

## 5. Bundle size (PERF-02)

- Zod: `import { z } from "zod"` pulls the namespace object of the classic entry, and with it all 40 translations (167 KB of the 390 KB of Zod in the browser). `import * as z from "zod"` lets the bundler keep only what is used (113 KB of Zod, translations 3 KB); measured with `next build`, it gives the same first-load sizes as a barrel of named re-exports (jobs 734 KB, passport 756 KB), and `{ z }` gives 1012 and 1034 KB. The application therefore uses the namespace import, and an ESLint rule (`no-restricted-syntax`, tested in `zod-import-rule.test.ts`) refuses `import { z } from "zod"` and the default import in `app`, `components`, `lib` and `emails`.
- supabase-js (224 KB) was in the first load of the passport page for the document list, the access log and the upload. `lib/supabase/lazy-browser.ts` imports the browser client when the first read or upload needs it; the upload form loads it before it asks for the upload ticket, so a failed load creates no document row.

First-load JavaScript from `.next/diagnostics/route-bundle-stats.json` after `npm run build` (KB, uncompressed, and gzipped chunk by chunk):

| Route | Before | After | Before gz | After gz |
|---|---|---|---|---|
| `/[lang]/passport` | 1291 | 756 | 356 | 231 |
| `/[lang]/onboarding` | 1018 | 742 | 284 | 226 |
| `/[lang]/jobs` | 1010 | 734 | 282 | 225 |
| `/[lang]/signup` | 992 | 714 | 275 | 218 |
| `/[lang]/login` | 985 | 707 | 273 | 216 |
| `/[lang]/org/[slug]/jobs/new` | 1011 | 735 | 282 | 225 |
| `/[lang]/org/[slug]/billing/checkout` | 1010 | 732 | 282 | 225 |
| `/[lang]/admin/users` | 1001 | 724 | 279 | 221 |
| `/[lang]/org/[slug]/applicants` | 570 | 569 | 176 | 176 |
| `/[lang]/about` | 538 | 538 | 165 | 165 |

`/en/jobs` HTML: 334,325 B before (44,675 B gzip, 864 option nodes), 123,899 B after (23,010 B gzip, none). The rest is the reference lists (about 441 occupations with synonyms, 255 countries, industries, currencies) as props of the client components in the page data. Open item: serve the lists on demand (a cached route handler read when a combobox first opens, with a skeleton) so the page carries none of them; it is not part of this unit.

To find what is in a route: `npx next experimental-analyze -o` writes `.next/diagnostics/analyze/data/<route>/analyze.data` (a 4-byte length, then JSON with the sources and their sizes).

## 6. Departures

- The combobox has a server-rendered native select only where the form itself works without JavaScript: the country of the vacancy search sets `noScriptSelect`, and inside `<noscript>` a select with the country codes as values takes the place of the combobox (the form is a plain GET to the same address). It is in the HTML but never in the DOM of a browser with scripts. The other comboboxes are in forms that submit through React Hook Form and Server Actions, which need scripts, and a select with all their options in the server render would bring back the weight PERF-01 removes. The visible input has no `name`, so a native submit never sends a label.
- Home and End move the highlight only after an arrow key, so that they still move the cursor in the typed text.

## 7. Tests

Vitest: `combobox.test.ts` (matching, the cap, a chosen option beyond it, moving, the announcement), `job-filter-chips.test.ts`, `stage-filter.test.tsx`, `zod-import-rule.test.ts`. Playwright: `forms-and-search-usability.spec.ts` (click, tap and keyboard on `/jobs`, the onboarding country and the vacancy form, Home, End and ArrowUp, the free-text skills field, the open list under axe, the country without JavaScript, the cap, no layout shift, 44 px targets, the Filters group on a phone and a wide screen, chips, the Apply button, the plain GET form, the table roles, axe); `public-search.spec.ts`, `applicant-list.spec.ts`, `journey-tracker.spec.ts` and `shortlisting.spec.ts` follow the Apply button and the chips.
