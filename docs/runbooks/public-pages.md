# Runbook: public pages

FR-H1. The SOP (Public Website Publication, quarterly review, owner Marketing / Platform) has six steps, one output (the published pages), one KPI (accessibility violations, target 0 serious), one risk (outdated or non-compliant content) and two controls (the review workflow and the automated checks). The pages store nothing.

## 1. What is published

| Page | Address | Text |
|---|---|---|
| Home, How CHARA Works, Trust & Safety, About, Pricing | `/en`, `/en/how-it-works`, `/en/trust-safety`, `/en/about`, `/en/pricing` | in the code, `apps/web/app/[lang]/(public)/` |
| Contact, Imprint | `/en/contact`, `/en/imprint` | text in the code, details from the settings of section 2 |
| Find Jobs, Vacancy | `/en/jobs`, `/en/jobs/<id>` | the open and visible vacancies (FR-C3, FR-C4) |
| Ten legal pages | `/en/legal/<slug>` | the published version in `public.legal_documents`; a page exists exactly when a published version of its lower-case slug exists (FR-H3 adds publishing) |

The header links and the footer links are in `apps/web/lib/public/navigation.ts`. Every route renders per request (ADR-0004), so a change of a setting or of a legal text is on the page at the next request, without a release. The texts in the code are drafts until CHARA approves them (section 4); the Pricing page reads its plans from the database (FR-H2, `docs/runbooks/pricing.md`).

## 2. Settings: legal entity and contacts

Seven keys of `private.settings`, seeded empty by `20261104120000_public_settings.sql`, are read through `public.get_public_settings()`, the only way a visitor can read the table (no other key is returned):

| Key | Shown on |
|---|---|
| `legal_entity_name`, `legal_entity_address`, `legal_entity_registration_number`, `legal_entity_vat_id` | Imprint |
| `legal_entity_email` | Imprint, Contact |
| `privacy_contact`, `data_protection_contact` | Contact, Privacy Policy (below the text) |

Set a value as the database owner (SQL editor of the project), with a ticket; the value is a JSON text:

```sql
update private.settings set value = to_jsonb('Example GmbH'::text) where key = 'legal_entity_name';
```

An empty value, a missing key and a value of white space leave the row out of the page. An address that is the whole value and looks like an email address becomes a `mailto:` link; anything else is shown as escaped text (a line break in an address is kept). A page whose read of the settings fails answers 500 with the error page and a retry, and shows no detail.

`privacy_contact` is the contact shown to visitors. `private.settings.privacy_contact_email` (FR-B6) is the address the erasure job tells about a legal hold; set both, to the same address if CHARA has one privacy mailbox.

## 3. Release checklist (control: review workflow)

Before every release that changes a page or a text, and before go-live:

1. CHARA has approved the text of Home, How CHARA Works, Trust & Safety, About, Contact and Imprint, and legal review has cleared them. Record the approver, the date and the release in the go-live checklist.
2. `legal_entity_name`, `legal_entity_address`, `privacy_contact` and `data_protection_contact` are set in production. The gate fails while one is empty:
   ```sh
   npm run go-live:check -- settings.json plans.json
   ```
   (`settings.json` is the export of `private.settings` of `docs/runbooks/plan-limits.md`; the same gate checks the plan limits and the sold plans.)
3. The Trust & Safety page still says that paying for a plan does not make an organisation verified or move its vacancies up in search results (a Vitest test, `public-pages.test.tsx`, fails when the sentence goes).
4. The published Cookie Policy says that only strictly necessary cookies are used (no analytics, no advertising; the site sets no cookie for a visitor without a session, a browser test checks it), and no page promises a feature of a later phase. Both are read by the reviewer; the legal texts are FR-H3.
5. The CI job `e2e` is green: `public-pages.spec.ts` (all pages server-rendered, locale redirect and unknown pages, shared layout, keyboard, 360 px, no cookie, open vacancies only), `public-pages-content.spec.ts` (settings on the pages, axe on the 19 pages) and `public-pages-failure.spec.ts` (failed read of the settings).

## 4. KPI: accessibility violations

Target: 0 violations of impact serious or critical on the 19 public pages (Home, Find Jobs, one Vacancy, Pricing, How CHARA Works, Trust & Safety, About, Contact, Imprint, the ten legal pages), with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`. The test `public-pages-content.spec.ts` ("axe finds no serious or critical violation on any of the 19 public pages") fails the CI `e2e` job on one. The measure is that test's result per run, and, per release, the count of failing runs of it; there is nothing else to export. Moderate and minor findings are not gated: run axe by hand on the pages once a quarter.

## 5. Quarterly content review (step Maintain)

Owner: Marketing / Platform, as named in the SOP; CHARA writes the name of the person into the go-live checklist and into the calendar entry of the review. Each quarter the owner reads the six pages of section 3 item 1 and the Pricing page against the product (no text may describe a feature that does not exist), checks the seven settings of section 2, and records the date and the result. A change of text is a normal release (section 3). This review is a calendar task, not something the platform can enforce.
