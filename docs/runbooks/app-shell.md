# Runbook: app shell, navigation and error boundaries

NFR-U1 (usability), audit findings UX-01, UX-08, UX-10 and REL-01 (unit U57). The shell is built on the primitives of `design-system.md`; nothing here changes a permission.

## 1. What each area shows

| Area | Header | Footer |
|---|---|---|
| Public (`(public)`) | The links of `lib/public/navigation.ts` behind the Menu button below 768 px. A visitor sees Log in and Sign up; a signed-in person sees **Go to my area** (the dashboard of the account kind) and **Log out**. The session is read behind `Suspense`, so the page does not wait for it and the first paint is the visitor's header. | Imprint and the ten legal pages in three short groups (`footerGroups`) |
| Auth (`(auth)`) | Logo only | none |
| Signed-in (`(app)`) | `components/layout/app-nav.tsx`: logo to the dashboard of the account kind, the primary links, the organisation switcher (only with more than one organisation), the Account menu | the same legal links |
| Console (`(admin)/admin`) | Logo to `/admin` and the Account menu with the platform roles; the sidebar of `lib/admin/navigation.ts` stays, as a two or three column grid below `lg` | none |

Below 768 px the primary links, the switcher entries and the account items are one list inside the Menu panel (`header-menu.tsx`): they are in the markup and visible without JavaScript, and the Menu button appears only after hydration. The footer links are not prefetched (eleven prefetches followed every action), and the footer of a candidate's area leaves out the Subscription and Billing Terms, because the pages of a candidate hold no link about billing (FR-G6 AC5, `hidePaths` of `FooterLinks`). From 768 px the links are a row and the switcher and the Account menu are disclosure panels (`menu-disclosure.tsx`: a button with `aria-expanded`, Escape and a press outside close it, Tab enters it).

## 2. Which links, and why

`lib/app/navigation.ts` is the only place that decides it, and a Vitest file pins it (`app-navigation.test.ts`):

- Candidate: Dashboard, Find jobs, Saved, Applications, Passport.
- Employer, for the organisation named by the address (`/org/<slug>/...` or `?org=<slug>`, else the first one): Organisation (the dashboard), Vacancies, Applicants, Team, and Billing for owners and administrators only (the page needs `admin`).
- A suspended organisation has no links: each of its pages only says that it is suspended.
- The onboarding and consent pages (`isGatePage`) and an account without a committed kind, or a suspended account, have no page links; the Account menu still has Log out.
- Account menu: Settings for candidates only (the page sends an employer away), Notification settings for everybody, Log out.

The links are an offer, not a guard: every page still calls `requireUser`, `requireCandidate` or `requireOrgRole` itself, because a layout does not run again when a person moves between pages. **To add a page to the header, add it to the model with the same role the page asks for, and add a case to the test.**

## 3. The layout does not run again

The `(app)` layout reads the account kind and the organisations once per full render. An action that changes them calls `refreshAppShell()` (`lib/app/refresh-shell.ts`, `revalidatePath` of the layout) before it redirects: `commitAccountKind`, `chooseAccountKind`, `createOrganization`, `createPassport` and `acceptInvitation`. Without it a new employer would see an empty header until the next full page load (the browser test "a new employer has the links of the header as soon as the organisation exists" fails without it). A new action that changes the kind, the memberships or the status of an organisation needs the same call.

## 4. Breadcrumbs

`components/layout/breadcrumbs.tsx` (`nav aria-label="Breadcrumb"`, the last item is the page and has `aria-current="page"`, every earlier item is a link). Pages pass it to `PageHeader`'s `breadcrumb` slot, or put it first in the page when there is no `PageHeader`. The first item of an organisation page is `organizationCrumb(lang, organization)`. Used by: Vacancies, New vacancy, a vacancy, its preview, Applicants (with the vacancy when filtered), an applicant, Team, Billing, Checkout, Settings and Notification settings. The "Back to ..." links these pages had are gone (the empty state of the applicant list keeps its own link).

`/org/<slug>` is no longer a hub with four links: it redirects to the dashboard of the organisation (where an accepted invitation lands) and only says so for a suspended organisation.

## 5. Error boundaries (REL-01)

`(app)/error.tsx`, `(auth)/error.tsx` and `app/global-error.tsx` use `LoadError` (a toast, "Nothing was changed", Try again through the stable `retry` prop of Next 16.3, and `homeHref`). The `(app)` and `(auth)` boundaries sit inside their layouts, so the header and footer stay; the pages that have a boundary of their own keep it. `global-error.tsx` replaces the root layout, so it brings its own `html` and `body` and imports `globals.css`. Not-found pages already exist for every group (`(app)`, `(public)`, `(admin)/admin`, a public vacancy and `global-not-found.tsx`); no group that can call `notFound()` lacks one.

The error text never contains the cause: the page says what failed and nothing else; the cause is in the server log.

## 6. Tests

- Vitest: `app-navigation.test.ts` (links per role, current page, active organisation), `app-shell.test.tsx` (the header markup per role, the layout per account state, breadcrumbs, footer, the three boundaries), `public-navigation.test.ts`, `organization-action.test.ts` and `choose-account-kind-action.test.ts` (the shell refresh).
- Playwright: `app-shell-navigation.spec.ts` (the links per role, the Team page reachable after the first vacancy, the switcher, the refresh after onboarding), `app-shell-menus.spec.ts` (mobile menu with and without JavaScript, the account menu with the keyboard and a tap, the signed-in public header, the footer, the console on a phone, axe at 1280 and 375), `breadcrumbs.spec.ts`, `error-boundary.spec.ts` (own project: a function is withdrawn from the API roles while it runs).

## 7. Measured

First-load JavaScript of the `(app)` routes grew by about 35 KB uncompressed (36 KB for the pages with the most client code), the public routes by 23.6 KB (the log-out button), the console routes by about 27 KB, from the `route-bundle-stats.json` of two builds. The weight is the header client code and the log-out button's dependencies; no dependency was added.
