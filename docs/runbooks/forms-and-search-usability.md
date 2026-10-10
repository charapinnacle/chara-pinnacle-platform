# Runbook: forms and search usability

NFR-U1 (WCAG 2.2 AA), NFR-P1 (performance), audit findings UX-02, UX-06, PERF-01, PERF-02 and A11Y-01 to A11Y-03 (unit U58).

## 1. Combobox (`components/forms/combobox-field.tsx`, `lib/combobox.ts`)

The WAI-ARIA 1.2 editable combobox with a list popup. The field names and the codes it submits are unchanged, so every form and server action keeps working.

- Opens on click, tap, the chevron button and ArrowDown. Typing filters the whole list. A click or tap on an option, or Enter on the highlighted one, chooses it.
- The list is only in the page while it is open and holds at most `COMBOBOX_LIMIT` (50) options. When more match, a line under the list says "Showing the first 50 of N. Type to narrow the list." and a polite live region announces the count ("N results available, the first 50 are listed. Type to narrow the list.", "No match" for none).
- Keys: ArrowDown and ArrowUp open the list and move the highlight (it stops at the ends); Home and End move to the first and last option once an arrow key has been used (before that they move the text cursor); Enter chooses the highlighted option (and does nothing special when none is highlighted, so a form still submits); Escape closes and drops the typed text; Tab or any blur closes and drops the typed text, the chosen value stays. `aria-activedescendant` names the highlighted option and `aria-controls` the list while it is open.
- A click opens the list with no option highlighted, or with the chosen one when it is among the first 50, so an Enter on a form field does not pick the first option by accident.
- Targets: the chevron is a 44 by 44 px button (`tabindex="-1"`, the field itself is the one tab stop) and every option is at least 44 px high. The list is absolutely positioned, so opening it moves nothing.
- Free-text mode (skills) keeps its meaning: the value is the typed text and the options are suggestions.

## 2. Vacancy search (`/[lang]/jobs`)

Keyword, country and the Search button stay visible. The other nine controls (city, occupation, industry, employment type, recruitment, the three salary fields, accommodation, visa support) are in the "Filters" group: open at 1024 px and wider, where the form is a column beside the results; below that a "Filters" button (`aria-expanded`, `aria-controls`) opens it and a second submit button, "Show results", ends it. A submit that the form refuses because of a field in the closed group opens the group, so the message can be seen. Active filters are chips (`components/jobs/active-filters.tsx`, `lib/jobs/filter-chips.ts`): each is a link to the same search without that filter (the minimum salary goes with its currency and pay period), at least 44 px high, working without JavaScript. The query parameters and the server-side search are unchanged.

## 3. Stage filter

`components/applications/stage-filter.tsx` is a server component: a GET form with the select and an "Apply filter" button, and the other parameters of the address (vacancy, sort, direction, view) as hidden fields. Choosing a stage changes nothing by itself (WCAG 3.2.2); Apply loads the first page of that stage. It works without JavaScript. "All stages" gives `?stage=` which every list reads as no filter.

## 4. Other fixes

A single-line checkbox row is at least 44 px high (`min-h-11` on `CheckboxRow`). The stacked applicant table on a phone keeps `role` table, rowgroup, row, columnheader and cell, as the documents table does.

## 5. Bundle size (PERF-02)

- Zod: `import { z } from "zod"` pulls the namespace object of the classic entry, and with it all 40 translations (167 KB of the 390 KB of Zod in the browser). The application imports `* as z from "@/lib/zod"`, a barrel of named re-exports of what it uses; the bundler then keeps only those and what they need (113 KB of Zod, translations 3 KB). Using a new Zod function means adding its name to `lib/zod.ts` (the compiler says so).
- supabase-js (224 KB) was in the first load of the passport page for the document list, the access log and the upload. `lib/supabase/lazy-browser.ts` imports the browser client when the first read or upload needs it.

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

`/en/jobs` HTML: 334,325 B before (44,675 B gzip, 864 option nodes), 123,899 B after (23,010 B gzip, none). The rest is the options as props of the client components in the page data; a list read on demand would remove it and is not part of this unit.

To find what is in a route: `npx next experimental-analyze -o` writes `.next/diagnostics/analyze/data/<route>/analyze.data` (a 4-byte length, then JSON with the sources and their sizes).

## 6. Departures

- The combobox has no server-rendered native select. The forms that use it submit through React Hook Form and Server Actions, so none works without JavaScript, and a select with all options in the server render would bring the nodes PERF-01 removes back. Only the stage filter and the filter chips are plain HTML (the signed-in pages stream their content, which also needs scripts to show).
- Home and End move the highlight only after an arrow key, so that they still move the cursor in the typed text.

## 7. Tests

Vitest: `combobox.test.ts` (matching, the cap, moving, the announcement), `job-filter-chips.test.ts`, `stage-filter.test.tsx`. Playwright: `forms-and-search-usability.spec.ts` (click, tap and keyboard on `/jobs`, the onboarding country and the vacancy form, the cap, no layout shift, 44 px targets, the Filters group on a phone and a wide screen, chips, the Apply button, the plain GET form, the table roles, axe); `public-search.spec.ts`, `applicant-list.spec.ts`, `journey-tracker.spec.ts` and `shortlisting.spec.ts` follow the Apply button and the chips.
