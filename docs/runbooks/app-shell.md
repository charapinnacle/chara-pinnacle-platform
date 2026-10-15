# Runbook: app shell, navigation and error boundaries

NFR-U1 (usability), audit findings UX-01, UX-08, UX-10 and REL-01 (unit U57). The shell is built on the primitives of `design-system.md`; nothing here changes a permission.

## 1. What each area shows

| Area | Header | Footer |
|---|---|---|
| Public (`(public)`) | The same header on every public page (U73, OPEN_QUESTIONS.md D90, which replaces the header lists of P18 and P22): the logo tile and wordmark, then Find Jobs and For employers (on `/[lang]/employers` For job seekers, to the home page, instead of both; `audience-links.tsx`), then **Post a Job** (D81 and P22: a visitor goes to `/signup?kind=company`, a signed-in employer through `/post-job` to the new-vacancy page of their first organisation in which they may publish, or to the employer dashboard without one; a candidate, a member who cannot publish and a suspended account see none), then **Sign in** for a visitor (the login page links to the sign-up) or **Go to my area** (the dashboard of the account kind) and **Log out** for a signed-in person; from 1024 px also How it works; below 768 px the **Menu** button (none on a desktop, owner 15 October 2026). Menu opens `SiteMenu` (`site-menu.tsx`), a modal side panel (`dialog` with `showModal`, aria-expanded and aria-controls on the button, focus on Close menu and back on Menu, Escape, the close button and the backdrop close it; without JavaScript a link to `#site-menu` shown by `:target`) with Explore (Find Jobs, For employers, For job seekers, How Chara Pinnacle works), "Coming in a later phase" (the client's seven later items as text under one "Not yet available" tag, never links) and Sign in / Sign up (Go to my area / Log out). Below 768 px only the logo, Post a Job, Sign in and Menu stay (a signed-in person keeps Go to my area, and Log out moves into the panel); below 420 px Post a Job and Go to my area move into the panel as well. The session is read with the page, not behind `Suspense` (U63): React streams a finished boundary separately once a page passes about 12.8 kB of HTML, and the larger public pages left the account items hidden without JavaScript and late with it; a signed-in person never sees Sign in or Sign up. The log-out in this header is a plain form around the `signOut` server action (no client component, so visitors download no log-out code and it works without JavaScript); a failed sign-out only reloads the page, the toast of `LogoutButton` belongs to the signed-in area. | On black, under the logo, three columns (U66, `publicFooterColumns` in `lib/public/navigation.ts`, rendered by `FooterColumns`): Platform (Find Jobs, For employers, How Chara Pinnacle works, Pricing), Company (About, Trust & Safety, Contact) and Legal (Imprint, Privacy Policy, Terms of Service, Cookie Policy and All legal documents, which opens the index `/[lang]/legal` of the Imprint and the ten legal documents with their versions (`legalGroups`)): every legal document is two clicks from every public page. Pricing, Trust & Safety, About and Contact are footer-only (P18) |
| Auth (`(auth)`) | Logo only | none |
| Onboarding (`(onboarding)`, U68) | The logo tile with CHARA and Pinnacle (to the public home) and a quiet Log out (`LogoutButton`); no links, no account menu, no sidebar or identity. The step sits in one centred column of 35 rem (`OnboardingPanel`), with `OnboardingSteps` above its heading (design-system.md section 10) | the same small line of legal links as the signed-in area |
| Signed-in (`(app)`) | `AppShell` (U59): from 1024 px a sidebar (`app-sidebar.tsx`) with the logo to the dashboard of the account kind, the primary links with icons and the organisation (the switcher with more than one) or the account at its foot; the top bar keeps the Account menu. Below 1024 px the top bar has the logo and `app-nav.tsx`: the links and the switcher as a row from 768 px, the Menu below | one small line (`appFooterLinks`): Terms, Privacy, Imprint, All legal documents |
| Console (`(admin)/admin`) | `AppShell` as well: the entries of `lib/admin/navigation.ts` in the sidebar from 1024 px (`admin-sidebar.tsx`), a two or three column grid under the top bar below it; the Account menu with the platform roles | none |

In the signed-in area, below 768 px the primary links, the switcher entries and the account items are one list inside the Menu panel (`header-menu.tsx`): they are in the markup and visible without JavaScript, and the Menu button appears only after hydration. The footer links are not prefetched. No footer of the signed-in area links to the Subscription and Billing Terms, so the pages of a candidate hold no link about billing (FR-G6 AC5); the index of legal documents lists them for everybody. From 768 px the links are a row and the switcher and the Account menu are disclosure panels (`menu-disclosure.tsx`: a button with `aria-expanded`, Escape and a press outside close it, Tab enters it).

## 2. Which links, and why

`lib/app/navigation.ts` is the only place that decides it, and a Vitest file pins it (`app-navigation.test.ts`):

- Candidate: Dashboard, Find jobs, Saved, Applications, Passport.
- Employer, for the organisation named by the address (`/org/<slug>/...` or `?org=<slug>`, else the first one): Organisation (the dashboard), Vacancies, Applicants, Team, and Billing for owners and administrators only (the page needs `admin`).
- A suspended organisation has no links: each of its pages only says that it is suspended.
- The consent page (`isGatePage`) and an account without a committed kind, or a suspended account, have no page links; the Account menu still has Log out. The onboarding pages are outside this shell (the `(onboarding)` layout above).
- Account menu (U64): Edit profile (the passport) and Settings for candidates (the Settings page holds the way to the notification settings and the account deletion); Settings for employers, which are the notification settings (the account settings page sends an employer away); Log out.

The links are an offer, not a guard: every page still calls `requireUser`, `requireCandidate` or `requireOrgRole` itself, because a layout does not run again when a person moves between pages. **To add a page to the header, add it to the model with the same role the page asks for, and add a case to the test.**

## 3. The layout does not run again

The `(app)` layout reads the account kind and the organisations once per full render. An action that changes them calls `refreshAppShell()` (`lib/app/refresh-shell.ts`, `revalidatePath` of the layout) before it redirects: `commitAccountKind`, `chooseAccountKind`, `createOrganization`, `createPassport`, `acceptInvitation` and every team action (`runTeamAction`: the role label and the Billing link of the person who accepts a transfer, or is given another role, change at once). Without it a new employer would see an empty header until the next full page load (the browser test "a new employer has the links of the header as soon as the organisation exists" fails without it). A new action that changes the kind, the memberships or the status of an organisation needs the same call.

The `(app)` and `(admin)` layouts and the public header await the session at the top level, which ADR 0004 decision 4 advises against: the logo target, the header and the footer of a candidate depend on it, and every page awaits it anyway. This is a recorded departure; enabling Cache Components later means moving these reads behind `Suspense` with a static header. The read of the organisations in the `(app)` layout does not fail the page: on an error the header is drawn without organisation links, with the Account menu and Log out, and the error is in the server log (an `error.tsx` does not catch an error of the layout of its own segment).

Known limit: the organisation a person works in is read from the address (`/org/<slug>/...` or `?org=`). The Notification settings links carry `?org=` for a person in several organisations; the other pages without an organisation in the address (`/mfa`, `/consent`) show the first organisation.

## 4. Breadcrumbs

`components/layout/breadcrumbs.tsx` (`nav aria-label="Breadcrumb"`, the last item is the page and has `aria-current="page"`, every earlier item is a link). Pages pass it to `PageHeader`'s `breadcrumb` slot, or put it first in the page when there is no `PageHeader`. The first item of an organisation page is `organizationCrumb(lang, organization)`. Used by: Vacancies, New vacancy, a vacancy, its preview, Applicants (with the vacancy when filtered), an applicant, Team, Billing, Checkout, Settings and Notification settings. The "Back to ..." links these pages had are gone (the empty state of the applicant list keeps its own link).

`/org/<slug>` is no longer a hub with four links: it redirects to the dashboard of the organisation (where an accepted invitation lands) and only says so for a suspended organisation.

## 5. Error boundaries (REL-01)

`(app)/error.tsx`, `(auth)/error.tsx`, `(onboarding)/error.tsx` and `app/global-error.tsx` use `LoadError` (a toast, "Nothing was changed", Try again through the stable `retry` prop of Next 16.3, and `homeHref`). The `(app)`, `(auth)` and `(onboarding)` boundaries sit inside their layouts, so the header and footer stay; the pages that have a boundary of their own keep it. `global-error.tsx` replaces the root layout, so it brings its own `html` and `body` and imports `globals.css`. Not-found pages already exist for every group (`(app)`, `(public)`, `(admin)/admin`, a public vacancy and `global-not-found.tsx`); no group that can call `notFound()` lacks one.

The error text never contains the cause: the page says what failed and nothing else; the cause is in the server log.

## 6. Tests

- Vitest: `app-navigation.test.ts` (links per role, current page, active organisation), `app-shell.test.tsx` (the header markup per role, the layout per account state, the onboarding layout without navigation, breadcrumbs, footer), `route-errors.test.tsx` (the four boundaries), `public-navigation.test.ts`, `organization-action.test.ts` and `choose-account-kind-action.test.ts` (the shell refresh).
- Playwright: `app-shell-navigation.spec.ts` (the links per role, the Team page reachable after the first vacancy, the switcher, no links or account menu during onboarding and the links as soon as it ends), `onboarding-journey.spec.ts` (the onboarding layout on every step), `app-shell-menus.spec.ts` (mobile menu with and without JavaScript, the account menu with the keyboard and a tap, the signed-in public header, the footer, the console on a phone, axe at 1280 and 375), `breadcrumbs.spec.ts`, `error-boundary.spec.ts` (own project: a function is withdrawn from the API roles while it runs).

## 7. Measured

First-load JavaScript of the `(app)` routes grew by about 35 KB uncompressed (36 KB for the pages with the most client code), the console routes by about 27 KB, from the `route-bundle-stats.json` of two builds. The weight is the header client code and the log-out button's dependencies; no dependency was added. The public routes carry none of it, because their log-out is a form.
