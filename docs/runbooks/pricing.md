# Runbook: pricing page from configuration

FR-H2, design point D72 (OPEN_QUESTIONS.md). The SOP (Pricing Page from Configuration, quarterly review, owner Finance / Platform) has four steps (read, display, change, verify), one output (the pricing page), one KPI (pricing mismatches, target 0), one risk (the advertised price differs from the charged price) and two controls (a single source of truth, and a test). The page stores nothing.

## 1. What the page shows and where it comes from

`/[lang]/pricing` reads `public.v_plans` on every request (the `(public)` group renders per request, ADR-0004), so a changed record is on the page at the next request without a release. The query (`listPublicPlans`, also the source of the plans the billing pages sell) keeps the public employer plans (`is_public`), in `sort` order, at most 20. The `is_public` filter is in the query and not left to the row policy, because a member also reads the plan of the own organisation when it is not public (the fallback plan, Enterprise before its price is stated).

| Shown | Record |
|---|---|
| Card heading | `billing.plans.name` |
| Price, in the currency code and with the label `excl. VAT`, and `per <interval>` | `price_minor`, `currency`, `interval` (the same `formatPrice` as the checkout page, so the two agree character for character) |
| Trial text: `<n> days free trial`, the price after it, the automatic conversion, one trial for each legal entity (`daysText`, `trialConversion` and `oneTrialRule` of `lib/billing/presentation.ts`, the same text as the checkout) | `trial_days`; no trial text at 0 |
| A plan sold by contact: no price, no trial, a link `Contact sales about <name>` to the contact page | `contact_sales` |
| Limits: active vacancies, team members | `billing.plan_limits` (`active_jobs`, `members`); a null value shows no line |
| Features | `billing.plan_features`, only keys that have a label |

A plan lists only what this release delivers: the labels in `apps/web/lib/billing/pricing.ts` (`limitLabels`, `featureLabels`) are the list. Today the features are `shortlisting` and `csv_export`; `analytics_advanced` is a record of the plans but has no label because no page of Phase 1 uses it. The release that delivers a feature adds its label there. Nothing else on the page names a feature, and the page states that a paid plan does not make an organisation verified or move its vacancies up in search results.

The link of a card depends on who reads the page: a visitor is led to the generic sign-up (the account type is chosen after it, D72 point 8), an owner or admin to the billing page of the first organisation they own or administer, and a worker, a plain member and a person who has not finished setting up see a note and no link to buy. If the organisations of the person cannot be read, the plans still show with neither note nor link.

## 2. Changing a price, a name, a trial or a limit (SOP FR-G1)

In Phase 1 the only way is a reviewed migration plus the same change in `supabase/seeds/ref/plans.sql` (see FR-G1). Then run the Stripe mirror (`docs/runbooks/checkout.md` section 3) so that the charged price follows. The page needs nothing: it shows the new values at the next request.

Until CHARA confirms them: the price of Professional (7900, C10), the display name of the lowest plan (Basic, C13) and the price of Enterprise (not stated, so it stays `is_public = false` and is not shown; once it is stated, set `is_public = true` and `price_minor`, or `contact_sales = true` to show a contact link instead of a price).

## 3. Control and KPI: pricing mismatches

- The browser test `apps/web/tests/e2e/pricing.spec.ts` (AC8) compares the name, price, interval and trial days of every card with its `billing.plans` row and then follows the owner's path to the checkout confirmation, which must show the same name, price and trial. It runs in the CI `e2e` job; any difference fails the job. The KPI is the count of failing runs of that test per release (target 0).
- The charged price is the Stripe price mirrored from the same record; `scripts/check-go-live.mjs` fails when Stripe holds another amount than `price_minor` (checkout.md section 3), so a price changed in the database and not mirrored cannot go live unnoticed.
- Not verified against live Stripe: the amount actually charged. That is the manual go-live check.

## 4. Quarterly review (step Maintain)

Owner: Finance / Platform, as named in the SOP; CHARA writes the name of the person into the go-live checklist and the calendar entry. Each quarter the owner reads the Pricing page against the current price list and the Subscription and Billing Terms, and records the date and the result. The platform cannot enforce this; it is a calendar task.
