# Runbook: design system

NFR-U1 and NFR-U2, audit findings DS-01 to DS-03, CODE-01, CODE-02, CODE-05 and UX-07 (unit U56); the brand, the app layout and the dashboards of unit U59 (audit findings UX-03, UX-04, UX-10); the public site and the sign-in journey of unit U63 (section 6); the forms and the pages after sign-up of unit U67 (section 9); the onboarding of unit U68 (section 10); the home page of units U70 and U71 (section 11). The tokens live in `apps/web/app/globals.css`; the shared components in `apps/web/components/layout`, `components/feedback`, `components/forms` and `components/dashboard`. `components/ui` holds the shadcn/ui primitives: they are never edited, a component wraps them.

## 0. Design brief

CHARA sells into a design-sensitive European market. The product is calm, confident and typographic, in the Swiss and Nordic tradition (Linear, Stripe, Vercel, Personio, N26): it must never look like a template website.

- **Brand.** The owner's gold CP monogram on black (`docs/phase-1/client/brand/`, not in git; web copies in `apps/web/public/brand/` as PNG and WebP at 128 and 512 px, the favicon `app/icon.png`, `app/apple-icon.png`, all cropped from it, never redrawn; `app/opengraph-image.tsx` sets the 512 px monogram beside the wordmark CHARA and Pinnacle in Geist on 1200 by 630 px with `next/og`). The monogram sits only on black: its own tile in the headers and the sidebar, the dark footer and the dark panel of the sign-in pages. Next to it the wordmark CHARA in the UI typeface with wide tracking, and Pinnacle in small capitals in gold where there is room (sidebar, footer, sign-in panel).
- **Name.** The product is called "Chara Pinnacle" (owner decision 2026-10-12, OPEN_QUESTIONS.md D86) in running text, titles, metadata, emails, accessible names and alt texts. The name comes from one constant, `BRAND_NAME` in `apps/web/lib/brand.ts`, which the pages, the email templates of `apps/web/emails` and the alt text of the Open Graph image read; the title template of `app/[lang]/layout.tsx` adds " — Chara Pinnacle" to the title a page sets (a page names only itself, the search metadata of `lib/seo/metadata.ts` is absolute). The Auth templates (`supabase/templates`) and the subjects and local sender of `supabase/config.toml` cannot import it and are kept equal by `tests/unit/account-email-wording.test.ts`. Not the name: the logo lock-up CHARA / PINNACLE, the feature names of the specification (CHARA Passport, CHARA Worker Passport, CHARA Match, CHARA Verified; question P24), technical identifiers (`CHARA_*` error codes, `x-chara-signature`, `chara_*` cookies, schema, function, route and variable names) and the stored legal texts.
- **Palette.** Near-black ink for text and the primary button, warm off-white for the page, white cards, hairline borders. Gold is the single accent and appears sparingly: the gold mark of the current sidebar item, the progress bars, the icon tiles, the underline of text links. Gold is never text on a light surface: `brand-ink`, a deep bronze, is (6.57:1). Status colours are semantic only (green, amber, red, blue, grey) and every status is also said in words.
- **Type.** Geist (variable, `latin` and `latin-ext` for European names), loaded with `next/font` from our own origin. Headings are large, tight and semibold, on every page including the home page (one family since U71, section 11); secondary text is quiet (`muted-foreground`); figures use tabular numbers (`tabular-nums`).
- **Space and surfaces.** An 8 px grid: 16 px gutters on a phone, 24 px on a tablet, 40 px on a desktop; 24 px between the blocks of a section and 32 px between sections (`gap-page`, `gap-section`). Cards have a 10 to 14 px radius, a hairline border and one very soft shadow; no heavy boxes.
- **Motion.** Purposeful and short: 150 ms for colour, 200 ms for movement, 240 ms for entrances, all `ease-brand` (an ease-out). Cards rise 6 px as they appear, the figure cards, panels and list rows of a dashboard one after the other (`animate-stagger`, 50 ms apart), menus fade and scale from 95 %, skeletons shimmer, progress bars fill. Every animation stops under `prefers-reduced-motion` (the base layer sets durations and delays to zero).
- **Copy and conduct.** Short, precise, friendly; GDPR-aware and honest (no dark patterns, no claim the data does not support). Dates are written in full (`formatDate`), short European dates (`formatShortDate`, 3 Oct 2026) in lists, relative times ("2 hours ago", `formatRelative`) beside the exact date in a `time` element. Money is `EUR 39.00` with the VAT note.
- **Accessibility.** WCAG 2.2 AA: every pair below is tested, focus is a 2 px bronze outline outside the cascade layers, targets are at least 40 px (44 px for touch controls), charts are tables with bars added for the eye only.

## 1. Tokens

Every colour is a token in the `:root` block of `globals.css`; the `.dark` block is the tested dark set (not applied).

### Type scale

One utility per size, from `@theme` in `globals.css`. `display` and `h1` step up at the `sm` breakpoint (40 rem), and `hero` and `section` at `sm` and `lg`, through a `:root` override, so a page never writes a responsive size by hand. A heading utility also sets its weight and tracking, so write `text-h2`, not `text-h2 font-semibold`.

| Utility | Size | Line height | Use |
|---|---|---|---|
| `text-hero` | 2.5 rem, 3.5 rem from `sm`, 4 rem from `lg` (40, 56, 64 px; semibold, tracking -0.04 em) | 1.05 | The one headline of the home page, nowhere else |
| `text-section` | 1.875 rem, 2.25 rem from `sm`, 2.5 rem from `lg` (30, 36, 40 px; semibold, tracking -0.03 em) | 1.15 | The section headings and the live figures of the home page |
| `text-display` | 2.25 rem, 3 rem from `sm` (tracking -0.035 em) | 1.15 | The title of the home page and of content and legal pages (`PageHeader size="display"`) |
| `text-h1` | 1.625 rem, 2 rem from `sm` (tracking -0.03 em) | 1.2 | The one title of a page (`PageHeader`), the card title of the auth pages |
| `text-h2` | 1.125 rem | 1.55 | Section and card headings, dialog titles |
| `text-h3` | 1 rem | 1.5 | Headings inside a section |
| `text-lead` | 1.125 rem | 1.75 | The tagline and the lead paragraph under a display title (the display variant of `PageHeader` does it for its description) |
| `text-figure` | 2 rem (tracking -0.03 em; add `tabular-nums`) | 1.15 | A number shown on its own (a count on a summary card) |
| `text-body` | 0.9375 rem | inherited | Running text in the application |
| `text-small` | 0.875 rem | 1.43 | Secondary text, labels, table headers |
| `text-caption` | 0.75 rem | 1.33 | The smallest text (a badge such as New) |
| `text-eyebrow` | 0.75 rem, semibold, tracking 0.14 em, written with `uppercase` | 1.33 | The label above a section heading on a marketing page (`SectionHeading`), the "On this page" list of a legal page, the statistics heading. In `brand-ink` on light, `brand` on black |

Arbitrary sizes such as `text-[1.75rem]` are not used. Every size in the interface is one of the utilities above.

### Spacing, radius, elevation and focus

| Token | Value | Use |
|---|---|---|
| `p-card-sm`, `p-card`, `p-card-lg`, `p-card-xl` | 0.75, 1, 1.25, 1.5 rem (xl is 2 rem from `sm`: `p-card-2xl`) | The padding sizes of a `Card`: sm for a row inside a list or a board column, md (default) for a list item or a block, lg for a dashboard card, xl for the auth card. `ModalDialog` uses the xl tokens directly |
| `gap-page`, `gap-section` | 1.5, 2 rem | The gap between the blocks of a page, and between the sections of a page that has several (team, vacancies, billing) |
| `rounded-lg`, `rounded-xl`, `rounded-2xl` | `--radius` times 1, 1.4, 1.8 (0.625 rem base) | Controls and buttons, cards, auth card and dialogs |
| `shadow-card` | one soft warm shadow | The single elevation: raised cards, the auth card, dialogs and toasts. There is no second shadow (a hovered figure card lifts by 2 px and uses the `md` shadow of Tailwind) |
| `max-w-content`, `--spacing-sidebar` | 75 rem, 16 rem | The width of the page column of the signed-in area, and of its sidebar |
| `ease-brand`, `animate-rise`, `animate-shimmer` | `cubic-bezier(0.22, 1, 0.36, 1)`; 240 ms rise of 6 px; 1.6 s band | Motion: transitions use `duration-150` (colour) or `duration-200` (movement) with `ease-brand`; `animate-rise` for an entrance, `animate-stagger` on a grid or list for its items in turn; `animate-shimmer` (on a `before:` layer, see `shimmerClassName`) for skeletons; menus use `animate-in fade-in zoom-in-95` of tw-animate-css |
| `--focus-ring`, `--focus-ring-offset` | `2px solid var(--ring)`, 2 px | The visible focus of every link, button, field and summary. It is drawn outside the cascade layers on purpose (see `tokens.test.ts`) |

### Colours

Core tokens: `background` (warm off-white), `foreground` (near-black ink), `card`, `primary` (ink, with `-hover`, `-active`, `-foreground`), `secondary`, `muted`, `muted-foreground`, `accent` (a warm gold tint for hover and selection, with `accent-foreground`), `destructive` (with `-hover`, `-active`, `-foreground`, `-surface`), `border`, `input`, `ring` (= `brand-ink`).

Brand tokens: `brand` (solid gold, C9973D, for marks, bars and icons, never text on light), `brand-highlight` (the light gold of the monogram, F3D27A, only inside the gradient), `brand-ink` (bronze, text and icons in gold on a light surface), `inverse`, `inverse-foreground`, `inverse-muted` (the black surfaces: footer, sign-in panel). `bg-brand-gradient` runs from `brand-highlight` to `brand` at 135 degrees and is kept for brand moments: the closing call to action of the home page, the step numbers, the Recommended badge and the rule of the sign-in panel. Text on the gradient is `text-inverse`, near-black in both themes.

Status tokens, five statuses with three tokens each: `success`, `warning`, `danger`, `info`, `neutral`, as `--<status>-foreground` (text and icon), `--<status>-background` and `--<status>-border`. Tailwind utilities: `text-success-foreground`, `bg-success-background`, `border-success-border`, and so on. `danger` is the `destructive` pair, `info` a quiet blue of its own (it no longer borrows the accent, which is gold now) and `neutral` the `secondary` text on a grey surface.

`:root` is the light theme. The `.dark` block is a complete dark theme (gold primary on ink) that is tested but not applied, because nothing puts the `dark` class on the root element yet (no theme switch exists). When a switch is built, it only has to set that class.

Contrast, computed by the WCAG formula from the tokens (`tests/unit/support/tokens.ts`; the same file is the test helper). Text pairs need 4.5:1, component boundaries (input, focus ring) 3:1. The border of a status is decorative: the label always says the status in words, colour never carries the meaning alone; the test only keeps it visible (at least 1.5:1 against its background and the card).

| Pair | Light | Dark |
|---|---|---|
| foreground on background / card | 18.68 / 19.67 | 17.51 / 16.44 |
| muted-foreground on background / card | 6.48 / 6.83 | 8.53 / 8.01 |
| muted-foreground on accent (the trial terms of a plan card) | 5.99 | 6.55 |
| secondary-foreground on background / card (the fact tags of a result card) | 14.31 / 15.07 | 15.53 / 14.57 |
| primary-foreground on primary / hover / active | 18.58 / 14.64 / 11.43 | 9.75 / 11.60 / 13.69 |
| destructive-foreground on destructive / hover / active | 6.47 / 8.06 / 10.11 | 7.88 / 9.42 / 11.80 |
| brand-ink on background / card / accent | 6.57 / 6.92 / 6.07 | 10.47 / 9.83 / 8.03 |
| accent-foreground on accent | 9.62 | 10.50 |
| inverse-foreground / inverse-muted on inverse | 18.04 / 8.53 | 18.75 / 8.87 |
| brand on inverse | 7.48 | 7.78 |
| inverse on brand / brand-highlight (text on the gradient) | 7.48 / 13.38 | 7.78 / 13.92 |
| success-foreground on success-background / card / background | 8.12 / 8.77 / 8.32 | 9.83 / 12.31 / 13.12 |
| warning-foreground on warning-background / card / background | 7.87 / 8.67 / 8.23 | 10.17 / 12.80 / 13.63 |
| danger-foreground on danger-background / card / background | 6.15 / 6.66 / 6.33 | 6.41 / 7.46 / 7.95 |
| info-foreground on info-background / card / background | 7.66 / 8.45 / 8.02 | 9.83 / 12.07 / 12.86 |
| neutral-foreground on neutral-background / card / background | 13.22 / 15.07 / 14.31 | 12.26 / 14.57 / 15.53 |
| input on card / background (3:1) | 3.64 / 3.46 | 5.07 / 5.40 |
| ring on card / background (3:1) | 6.92 / 6.57 | 9.15 / 9.75 |
| ring on inverse (3:1; on a `bg-inverse` surface the ring is `brand`) | 7.48 | 7.78 |

The gold itself (`brand`) on white is 2.6:1, so it is used only for marks, bars and decoration that a word next to it explains, and for text only on black.

`tests/unit/tokens.test.ts` checks every pair in both themes and fails when a token is changed below the limit.

## 2. Components

| Component | File | What it is | Rules |
|---|---|---|---|
| `Card`, `CardHeader`, `CardFooter` | `components/layout/card.tsx` | The one bordered surface. `as` is `div`, `section` or `li`; `padding` is `none`, `sm`, `md`, `lg` or `xl`; `elevated` adds `shadow-card`. The layout is a grid with a 0.75 rem gap that `className` replaces. `cardVariants` styles an element that cannot be a `Card` (a link, a toast) | No hand-written `rounded-xl border bg-card p-N`; the dialog and the radio option tile (`RadioGroupField`, a checked, focus and invalid state on a hidden input) are the two deliberate exceptions. A card that is a heading plus content is a `section` with `aria-labelledby` |
| `Section` | `components/layout/section.tsx` | A titled, raised `Card` with an anchor `id` (the passport sections, the admin detail pages) | |
| `PageHeader` | `components/layout/page-header.tsx` | The h1 of the page with `description`, `actions` (end of the row), `breadcrumb` (above) and further lines as children; `size="display"` for marketing and legal pages; `titleProps` for an `id` or `tabIndex` | Exactly one per page; the only place that writes a page title |
| `LinkButton` | `components/layout/link-button.tsx` | A link that looks like a button: `variant` primary, secondary or destructive, `size` default (36 px) or lg (44 px, the default, as `FormButton`) | Use it for navigation that must read as an action; anything that submits or runs an action is a `FormButton` |
| `FormButton` | `components/forms/form-button.tsx` | The button of every form and action: `variant` primary (full width), secondary or destructive, `busy` shows a `Spinner` and `aria-busy` | The destructive variant is for the control that carries out a deletion, a removal, a suspension or another final or hard-to-undo action (remove member, withdraw application, delete document, close or fill a vacancy, delete account, revoke role, suspend, hide). The control that only opens its confirmation dialog stays secondary |
| `StatusBadge` | `components/feedback/status-badge.tsx` | A pill coloured by `status`: `success`, `warning`, `danger`, `info` or `neutral` | The label says the status in words. Each domain maps its states to a tone next to its labels (`applicationStatusTones`, `jobStatusTone`, `moderationTones`, `planStatusTones`, `subscriptionStatusTones`, `accountStatusTones`); the type is `StatusTone` in `lib/status-tone.ts` |
| `Spinner` | `components/feedback/spinner.tsx` | A turning icon that stops under `prefers-reduced-motion` | Decorative: the control carries `aria-busy` and its own text |
| `Notice` | `components/forms/notice.tsx` | A message that stays on the page: tone `info`, `warning` or `error` | `role="alert"` for an error, `role="status"` for anything else announced. Warning is for something that needs attention but did not fail (a trial about to end, a limit, an incomplete passport) |
| Toast | `components/feedback/toast-store.ts` | `toast({ title })` for the outcome of an action, `toastError(title, reason?)` for a failure with the reason the server gave, `toastNetworkError(title)` for a call that could not be made | Never write `toast({ variant: "error" ... })` by hand. A list that could not load shows `LoadError` (toast plus a retry in the page) |
| `ModalDialog` | `components/feedback/modal-dialog.tsx` | The native dialog with its focus trap | The dialog is deliberately not a `Card`: the `grid` display of the card would override the `display: none` that a closed dialog needs. It copies the surface classes (border, `bg-card`, `shadow-card`) and the xl padding tokens |
| `useActionCall` | `components/feedback/use-action-call.ts` | Runs one server action from a button and toasts its outcome | |
| `BrandMark`, `BrandLink`, `Wordmark` | `components/layout/brand.tsx` | The monogram tile and the wordmark; `BrandLink` is the way home; the letter-spaced CHARA / PINNACLE lock-up is hidden from assistive technology and the accessible name is the product name, "Chara Pinnacle" (D86) | The monogram only on black. Never a second logo |
| `AppShell` | `components/layout/app-shell.tsx` | The frame of the signed-in area and the console: from 1024 px a 16 rem sidebar (brand, navigation, identity at its foot), a top bar with the account menu (and below 1024 px the brand and the menu of `AppNav`), the page in `max-w-content`, the legal links at the bottom | Pages put their content straight in it: lists and dashboards use the whole width; a form or a long text keeps `max-w-3xl`, left aligned |
| `AppSidebar`, `AdminSidebar`, `SidebarLink`, `SidebarIdentity` | `components/layout`, `components/admin` | The sidebar navigation (the same model as the header: `lib/app/navigation.ts`, `lib/admin/navigation.ts`) with a lucide icon per entry, the current page raised with a gold mark, and the organisation (the switcher for several) or the account at the foot | An entry is added to the model, with its `icon`; the icon maps are typed so a missing icon fails the build |
| `SummaryCard` | `components/dashboard/summary-card.tsx` | A figure of a dashboard: label, optional `hint` (part of the name), optional `detail`, the figure and View all; the whole card is the link to the list it counts, named "label: value" | Every figure comes from a query and states its unit and period in the label |
| `StageTable`, `StageBar` | `components/dashboard` | The stages of the pipeline as a table with a bar beside each number (SVG attributes, no inline style, hidden from assistive technology), a total, and a link per stage when a filtered list exists | The table is the chart: no chart library |
| `PageSkeleton` | `components/feedback/page-skeleton.tsx` | The loading state of a signed-in page in its final width (title, cards, panel) with the shimmer | `LoadingSkeleton` for a part of a page |
| `NativeSelect` | `components/forms/native-select.tsx` | A native select with the height, inset and chevron of the text input and the combobox | |
| `FormErrorSummary` | `components/forms/form-error-summary.tsx` | The error summary of a form: pass the `form`, the map from field name to input id (in display order) and the `summaryRef` of `useServerFormSubmit` | Every form with more than one field uses it. A form that must put focus on its first invalid field (the vacancy form, FR-C1 AC12) leaves `summaryRef` out |

Form feedback, in one place: field errors under the field and in the summary (which takes focus after a submit), the refusal of the server for the form in the summary (`root.server`), the outcome of a call in a toast, a standing message in a `Notice`.

## 3. How to add a variant

1. A colour or a size starts as a token in `globals.css`: add the variable to `:root` and to `.dark`, expose it under `@theme inline` as `--color-...`, and add its pairs to the lists in `tests/unit/tokens.test.ts`, which must stay at 4.5:1 (text) or 3:1 (boundary).
2. A new tone of `StatusBadge`: add it to `statusTones` in `lib/status-tone.ts` (the badge variants and the `Notice` tones are typed from it, so the build fails until each has a class), then add its three tokens as in step 1.
3. A new variant of `FormButton`: add it to `formButtonVariants` in `form-button.tsx`, with its `busy` compound variant. `LinkButton` takes it automatically.
4. A new size of the scale: add `--text-<name>` and its `--line-height`, `--font-weight` and `--letter-spacing` to the `@theme` block, add the name to the `font-size` group in `lib/utils.ts` (otherwise `cn()` treats it as a colour) and to `tokens.test.ts`.
5. Add the case to `tests/unit/design-system-components.test.tsx`.
6. Never edit `components/ui/*`. The `dark:` classes in those files do nothing until the `dark` class is applied to the root element.

## 4. Layout grid

The signed-in pages sit in a 12-column grid inside `max-w-content`: figure cards in a row of three from 1280 px (two from 640 px, one on a phone; at 1024 px the sidebar leaves too little width for three), then a main column of 7 or 8 and a side column of 5 or 4 for panels, lists and quick actions. Below 1024 px everything is one column in reading order, so the order of the markup is the order on a phone and for the keyboard.

## 5. Verification (U56, U59)

`npm test` (the tokens, the components and the contrast helper are in `tokens.test.ts`, `design-system-components.test.tsx`, `form-error-summary.test.tsx`, `utils.test.ts`, `toast.test.tsx`), `tests/e2e/design-system.spec.ts` (the destructive style, the spinner and the status badges in a browser), and the axe checks of the existing browser tests, which run on every screen the tokens reach.

## 6. The public site and the sign-in journey (U63)

The pages a visitor sees first are held to the brief of section 0, read as a European product page: typography carries the page, one dark brand surface per page at most, gold only where it marks something, and the content of the database shown as it is.

### Layout

- **Width.** Public pages use the full `PageContainer` (72 rem, 16/24 px gutters). Running text keeps a 65 ch measure inside it; nothing stretches a paragraph across the page.
- **Post a Job.** Every Post a Job of the home page (the hero's Post a Job and the closing call's Start hiring) leads where the header's does (`getPostJobHref` in `lib/dal/organizations.ts`): the employer sign-up for a visitor, `/post-job` for a signed-in employer, and none for a candidate, a suspended account or a member who cannot publish.
- **A failed read.** The home page reads only the statistics (`lib/dal/statistics.ts`) and where Post a Job leads; when the statistics fail the page leaves out the live figures, logs only the code and the message, and is still served.
- **Rhythm.** Sections of the home page have 80 px above and below on a phone and 112 px from `sm` (`py-20 sm:py-28`, section 11); content pages put 48 to 64 px between their header and their sections. Inside a section 24 to 40 px.
- **Editorial grid.** Content pages (How Chara Pinnacle works, Trust & Safety, About, Contact, Imprint) and the notes of the pricing page put each section heading in a 16 rem column beside its text from 1024 px, with a hairline above each section (`ContentSection`); on a phone the heading sits above its text.
- **Legal pages.** A text with three or more `##` headings gets "On this page" beside it from 1024 px (sticky) and between its header and its text on a phone; each heading has the anchor `section-<n>` in reading order. Shorter texts have no list.
- **Vacancy page.** From 1024 px the salary and the actions form a raised panel in a 20 rem column that stays in view while the description scrolls; on a phone the panel follows the title, so Apply is in the first screen. The key facts are a hairline grid (`dl`), the one place assistive technology reads them: the employer, location and employment type line under the title is a visual summary and hidden from it. The description keeps 65 ch, the employer card closes the page. The split follows the width the article has (a container query at 56 rem), so the employer preview, in the 48 rem column of the signed-in area, keeps one column with the panel after the title.
- **Find Jobs.** The search and the filters sit in a card in the 19 rem column; each result is a card: the title (the link) and the employer, then the location and the employment type as quiet tags with icons, accommodation and visa support as info badges, and the salary set apart above the date. Only the title link and Save are targets, so a card does not lift on hover; its hairline darkens.
- **Pricing.** Three columns from 1024 px with a subgrid, so the workers card on black ("Always free") and the plan cards share one top line; the plans fill their two columns with as many cards of at least 15 rem as fit in a row (`auto-fit`): two plans share the width, and three (Enterprise made public) stand in one row from 1280 px and wrap to two and one below it. The plan named by `RECOMMENDED_PLAN_CODE` in `lib/billing/pricing.ts` (OPEN_QUESTIONS.md P19) has a gold edge, the Recommended badge and the primary button; the other plans have a secondary button. The trial terms sit in a tinted block of the card; VAT is stated in the lead, beside every price and in Good to know.
- **Sign-in journey.** From 1024 px the black brand panel (sticky) and the form share the width; a short form is centred against the panel, a long one runs past it. Below 1024 px only the form shows. Onboarding has its own focused layout and steps (section 10).

### Components

| Component | File | Rules |
|---|---|---|
| `HeroSearch` | `components/home/hero-search.tsx` | A GET form to `/[lang]/jobs` with the fields `q` (What: job title, skill or occupation) and `where` (Where: city or country), 100 characters each; it needs no JavaScript. Find Jobs turns `where` into the country filter when it names a country (name or code, any case, accents ignored) and into the city filter otherwise, then answers with the address of those filters (U70). Its submit is the primary action of the home page |
| `SectionHeading` | `components/public/section-heading.tsx` | Eyebrow, h2 (its `id` names the section through `aria-labelledby`) and a lead line; `tone="inverse"` on black |
| `StepList` | `components/public/step-list.tsx` | The steps of `lib/public/steps.ts` on How Chara Pinnacle works (the home page lists the same steps under Who are you?, without the gradient numbers, U71); numbers on the gradient are hidden from assistive technology (the list is ordered); `titleAs="h4"` under an h3 |
| `PlanCard` | `components/public/plan-card.tsx` | One public plan from its record; the price is `text-figure` with `tabular-nums`; the card holds exactly the limit and feature items of its record |
| `OnboardingSteps` | `components/onboarding/onboarding-steps.tsx` | An ordered list named "Setting up your account" of the steps that are left (section 10); the current step has `aria-current="step"`, earlier steps say "(done)" to assistive technology |
| `AuthBrandPanel` | `components/layout/auth-brand-panel.tsx` | The monogram, the wordmark with Pinnacle, the claim and three points with icons, under a gold rule |

### Header and statistics

The account items of the public header (Log in and Sign up, or Go to my area and Log out) and the statistics block of the home page are rendered with the page, not behind a Suspense boundary: React streams a finished boundary separately once the HTML of a page passes about 12.8 kB, and such a part stays hidden without JavaScript and appears only after the load event with it, pushing the content below it down (FR-H1 AC1, AC3, FR-H4 AC1).

### Motion

The hero, the page headers and the auth form rise once (`animate-rise`); steps, safeguards, statistics, plan cards, results and content sections rise in turn (`animate-stagger`); the hairline of a result card darkens on hover in 200 ms; the arrow of Browse vacancies moves 2 px; an onboarding step rises once (section 10). All of it stops under `prefers-reduced-motion` (`tests/e2e/public-site-design.spec.ts`).

### Verification

`tests/e2e/public-site-design.spec.ts` (the hero search with and without JavaScript, the order of the home sections, reduced motion, the vacancy panel on a desktop and a phone, the recommended plan, the legal contents list, the sign-in split and the onboarding steps, and axe plus no sideways scrolling at 1440, 1024, 768 and 375 px on eight pages), `tests/unit/public-site-components.test.tsx`, `tests/unit/pricing-page.test.tsx`, `tests/unit/tokens.test.ts`, and the existing public page specs (`public-pages`, `public-pages-content`, `pricing`, `public-search`, `vacancy-page`, `legal-pages`, `design-system`).

## 7. Clean interface and the client's structure (U64)

The design brief of the client's presenter, applied to the home page, Find Jobs, the dashboards, Pricing, About, the passport and the footers: very clean, in the spirit of Indeed. Few elements per screen, generous white space, one clear primary action per screen, no repeated information, no decorative icon tiles, no subtitle under every heading, and underline only for real links. The tokens, the type system and the brand of sections 0 to 6 are unchanged. The wording, order and button names follow the client's document wherever they name something that exists today; OPEN_QUESTIONS.md D81 lists the departures and P20 to P22 the questions for the client.

- **Home.** Hero with the one search bar (keyword and city, `HeroSearch`) and a secondary Post a Job; Who are you? with a Worker and an Employer card; the CHARA Passport; How Chara Pinnacle works (`StepList compact`: numbered titles only); the live numbers under the heading Global Workforce Network (Workers, Employers, Active jobs, Countries); the closing call. No Trust & Safety block and no pill; U66 (section 8) restyles this structure with a dark hero, a trust strip of four statements and a dark closing band.
- **Find Jobs.** One search bar (keyword, city, country) with Search jobs, one row of four dropdowns (occupation, industry, employment type, recruitment), a More filters disclosure (a native `details`, so it works without JavaScript) for the salary, accommodation and visa support filters, and result rows without icons or cards (title, employer and place, salary and date; Apply now and Save job). `FormField` has `hideLabel` for a control that says what it is by its placeholder: the label stays for assistive technology.
- **Dashboards.** `SummaryCard` has no icon tile; the candidate dashboard is Profile completion, Availability, Saved jobs and Applications (the three latest, and the stages once); the employer dashboard is Active jobs, New applications, the plan on one line and Applications by stage. The sidebar has no group label and no icon tile at its foot.
- **Empty states** inside a card are `flat` (no border: no card inside a card).

Verification: `tests/e2e/public-header.spec.ts`, the home order test of `public-site-design.spec.ts`, `live-statistics.spec.ts`, `public-search.spec.ts`, `forms-and-search-usability.spec.ts`, `role-dashboards.spec.ts`, `dashboard-*.spec.ts`, the documents specs, the axe sweep at 1280 and 360 px; screenshots at 1440, 1280, 768 and 375 px before and after are kept in `docs/phase-1/client/evidence/U64/` (not in git).

## 8. A premium, classic home page (U66)

Replaced by section 11 (U71) except the footer, which stays as written here. The serif, the dark and light bands, the header over the hero, the reveal on scroll and `lift` no longer exist.

The owner asked for the finish of the main page of a large corporate site on the structure of section 7: clean, few elements, one primary action per section. U66 raises the finish and adds no element that does not exist today (OPEN_QUESTIONS.md D83).

- **Serif.** `--font-serif` is Newsreader, one weight (400) and the Latin subset, from `lib/display-font.ts`; only the home page imports that module, so only it preloads the file (the Link header of `/en` lists one font more than that of `/en/pricing`; `home-layout.spec.ts` checks it). It sets the h1 (`text-hero`, 44 px on a phone, 60 px from sm, 76 px from lg), the section headings and the step numbers (`text-section`, 30, 36 and 40 px) and the live figures (`text-numeral`, 48, 64 and 72 px) as `font-serif`; the three sizes carry weight 400, so no bold is synthesised, and `cn()` knows them. Never use it for body text, controls, labels or the headings of other pages without the owner's decision. Fallback: next/font writes a size-adjusted fallback face, so the swap does not move the page (layout shift under 0.01, tested).
- **Dark and light surfaces.** The `.dark` set of section 1 is applied by the `dark` class on a surface (the hero, the dark bands, the dark Employer panel, the footer) and the light set is put back by `light` inside it (the white search bar, the passport card). The header over the hero gets the dark set from the selector `.site-header:has(~ main [data-hero])`: a page that wants a header over a dark opening marks it with `data-hero`. `--focus-ring` is redeclared in the dark set, so a focus ring is the gold on a dark surface and the bronze on a light one (2 px, 3:1 or more; the pairs are in `tokens.test.ts`). On a dark surface text is `foreground`, `muted-foreground`, or the gold `brand` (eyebrows); on a light surface the gold is `brand-ink` only.
- **Hero.** The glow and the fine grid are one CSS background (`band-texture`, no image), faded out downwards. The h1 is `The Global Workforce Network` with the gold gradient on one word; the search is the white pill; Post a Job is the secondary action. The journey tracker preview (`journey-preview.tsx`) and the passport preview (`passport-preview.tsx`) are `aria-hidden`, generic and without any number, date, name or link (`home-components.test.tsx` checks it); each draws once (`journey-line`, `journey-current`, `passport-ring` in `components/home/home.css`, which only the home page loads).
- **Header.** From 768 px fixed over the hero: transparent at the top, solid after 5 rem of scrolling (CSS scroll-driven animation); solid where that is not supported, under reduced motion, and while the menu is open. `scroll-padding-top` keeps a focused element from sitting under it. Below 768 px it stays in the page flow, dark and solid, because without JavaScript its links are stacked (281 px at 375 px) and a fixed header would cover the headline and a third of every screen; the hero starts lower there. The rules are in `components/home/home.css`.
- **Bands.** `Band` (`components/home/band.tsx`) is a full-width section, tone light, tint or dark, whose content sits in the 72 rem column with 80 px (112 px from sm) above and below. Order: hero (dark), trust strip (light), Who are you? (tint, a light and a dark panel), the CHARA Passport (dark), How Chara Pinnacle works (light, a gold rule above each column), the live numbers when real (dark), the closing call (dark, with the hero's texture). The live numbers and the closing call are both dark, so when numbers are shown two dark bands follow each other (D83).
- **Motion.** `RevealOnScroll` (a client component of about 1 kB, no dependency) marks the bands that are fully below the first screen `data-reveal="pending"` after the first paint and sets them `shown` when they enter (`reveal`, 700 ms, 24 px); nothing already in view moves, the document keeps its size, and without JavaScript or under reduced motion nothing is hidden. `lift` raises a panel or a button 2 px under a mouse and only without reduced motion. The axe helper of the browser tests waits only for time-based animations; the header's scroll-driven one never ends by time.
- **Footer.** Platform, Company and Legal in three columns under the logo (`FooterColumns`, links in `publicFooterColumns`), the titles are paragraphs (no heading is added to a page), a hairline and the copyright line (`copyrightLine()` of `lib/brand.ts`: `© <year> Chara Pinnacle`, also at the foot of the signed-in area and of onboarding); every link is 44 px high on a phone and under a coarse pointer. The signed-in area keeps its one line.
- **Budgets.** The first-load JavaScript of `/[lang]` rose from 541,677 to 542,348 bytes of the 600,000 budget (the budget is unchanged); the largest paint is text, no image is on the critical path, and the CSP is unchanged (no inline style attribute, the font is self-hosted).

Verification: `tests/e2e/home-layout.spec.ts`, which replaced `home-premium.spec.ts` in U70 (no JavaScript, reduced motion, rise-in and layout shift, header, serif and font preload, largest paint and CSP, 320 to 1920 px, 44 px targets, focus rings, hover lift, footer, axe at 1280 and 360 px), `tests/unit/home-components.test.tsx`, `tests/unit/tokens.test.ts` (the dark-band pairs), the home order test of `public-site-design.spec.ts`, `public-header.spec.ts`, the keyboard journey and the accessibility sweep; screenshots at 1440, 1280, 768 and 375 px before and after (hero, each band, footer, header scrolled) are kept in `docs/phase-1/client/evidence/U66/` (not in git).

## 9. Forms, sign-up and the check-your-email pages (U67)

The owner called the sign-up form "very bad": a heavy grey consent panel with DRAFT in every label, small grey checkboxes, a double focus ring, no way to show the password. U67 gives every form one field, one checkbox and one button, and the pages after sign-up a plain Resend (OPEN_QUESTIONS.md D84). Presentation only, except the cookie of section 9.5.

### 9.1 Tokens

`--radius-control` (12 px, `rounded-control`: fields and their buttons), `--radius-card` (16 px, `rounded-card`: the auth card), `--spacing-card-3xl` (40 px: the padding of the `xl` card from `sm`; 24 px on a phone). A field is 48 px high (`h-12`), the primary `FormButton` 48 px, every other `FormButton` at least 44 px.

### 9.2 Field

`controlClassName` (`components/forms/control-class.ts`) is the look of every text control: `bg-card` on the page, a 1 px `--input` border (3:1 against the page and the card, tested in `tokens.test.ts`), `px-4`, and a focus that is the one 2 px outline of `--focus-ring` at a 2 px offset, the border turning `--foreground`; the primitive's own ring and border colour are cancelled in that class, so there is no second ring and no glow. Autofill keeps the white fill (an inset shadow) and the text colour. The height is set where the control is used (`h-12`), because a file input is taller. `FormField` lays out label (medium, 8 px above the control), control, helper (`text-small`, muted, 6 px below; hidden visually while the field has an error, as before) and `FieldMessage` (the error in the error colour with an icon, `role="alert"`, referenced by `aria-describedby`). The label stays in the text colour when the field is invalid: the border, the icon and the message say it. A read-only field (the invited address) has the muted fill.

### 9.3 Checkbox and choice

`Checkbox` (`components/forms/checkbox-field.tsx`) is the one checkbox: a native input, 20 px, `rounded-sm` (6 px), a 1.5 px `--input` border, `--primary` fill and a white check when checked (120 ms), `aria-invalid` and disabled states, the accent only in the focus outline. `CheckboxRow` is its row: at least 44 px, the label covers the row (a link inside it takes `relative z-10`), an optional `meta` line that belongs to the description of the box, not to its name, and the error under it. `CheckboxField` and `CheckboxGroupField` are the form versions (sign-up, onboarding, notification and report forms, filters, the apply and vacancy forms, billing checkout, admin dialogs); the bulk selection of the applicant list uses `Checkbox` in a padded label. Consecutive rows sit in a `grid` without a gap. `RadioGroupField` is a radiogroup of equal cards (`sm:grid-cols-2`): a line each, the chosen card has a near-black border and a check in its round indicator (the same 20 px, 1.5 px, near-black treatment as the checkbox), the others stay white; the native radio covers the card, so the arrow keys and the whole card work.

### 9.4 Consents and the password

`ConsentList` is a grid with a hairline between rows, no fill. `ConsentCheckbox` is one required consent of the sign-up form: "I accept the Terms of Service" with the title as a `LegalLink tone="plain"` (the text colour, a thin underline on hover and focus only), the meta line "Version 0 · 4 October 2026" and a neutral Draft badge for version 0 or a stored title that starts with DRAFT: (`isDraftDocument`). `displayTitle` removes the prefix for display and for the messages of the form; the stored title, the legal pages and their banner are not touched. The age row reads "I confirm that I am at least 18 years old." (`AGE_CONFIRMATION`) until a published wording exists (`ageConfirmationLabel`). `ConsentSection` is the same document on a page of its own (the consent page and the checkout): heading, Draft badge, version, change summary, "Read the full text", then the box.

`PasswordField` is the password input with a show and hide button (the name is Show password or Hide password and `aria-pressed` says which; it follows the input in the focus order) and, with `checklist`, a live list under it: "At least 12 characters" turns to a check mark at `PASSWORD_MIN_LENGTH`, is part of the description of the input, and a polite status announces only a change. The server keeps the breached-password check. It is used on sign-up (also the invitation), log in (no checklist) and reset.

### 9.5 Card, summary and the check-your-email pages

`AuthCard` is 16 px round, `max-w-lg`, a soft shadow, 40 px padding from `sm`, 24 px on a phone; the heading stays in the sans (the serif is imported only by the home page, D83). `ErrorSummary` has a 4 px left border in the error colour, an icon, and a list of links to the fields.

After sign-up (`/verify-email`) and after a reset request (`/forgot-password/check-email`) `CheckEmailPanel` shows the masked address, a Resend button without input, the cooldown on the button, the spam hint and "Use a different address". The address is in the cookie `chara_pending_email` (`lib/pending-email.ts`): httpOnly, SameSite=Lax, 30 minutes, path `/en`, Secure over https, set by the sign-up and reset-request actions, removed by the confirmation and the password change, never in a URL; it is unsigned, so the cooldown pre-check in `resendPending` is a courtesy and the limits are the throttle and Auth. The forms are filled in again only after "Use a different address" (a server action copies the address to `chara_prefill_email` for 60 s), never from `chara_pending_email`. `resendPending` checks the cookie, the 60 s cooldown (the `max_frequency` of Auth; `auth-config.test.ts` compares the two), the throttle (`rate_limit_attempt` through `throttleWait`, which returns the wait time) and then asks Auth; every outcome except a rate limit or a real failure is "sent", as for the forms. The button is `aria-disabled` during the cooldown and while sending, never `disabled` (it keeps the focus), and a polite live region announces the result. Without the cookie `/verify-email` shows the form that asks for the address (the same form serves the expired-link page).

### 9.6 Verification

`tests/e2e/forms-auth-polish.spec.ts` (consent rows, tap target, link underline, checkbox size, focus, account type cards, password toggle and checklist on sign-up, log in, reset and invitation, card, button and summary, axe and overflow at 1280 and 360 px), `tests/e2e/check-email.spec.ts` (masked address, cookie flags, no address in the URL, cooldown, resend, throttle, identical answers, failure, no cookie, different address, removal), `tests/unit/forms-controls.test.tsx`, `tests/unit/check-email-panel.test.tsx`, `tests/unit/pending-email.test.ts`, `tests/unit/tokens.test.ts`, and the updated sign-up, recovery, rate-limit, keyboard and consent specs. Screenshots before and after at 1440, 1280, 768 and 375 px are in `docs/phase-1/client/evidence/U67/` (not in git).

## 10. Onboarding (U68)

The steps between a confirmed email and the product have their own layout and an honest step indicator (OPEN_QUESTIONS.md D85). Flow and presentation only: every guard and audit row is unchanged.

### 10.1 Layout

`app/[lang]/(onboarding)/layout.tsx` frames `/onboarding`, `/onboarding/security` and `/onboarding/welcome`: a slim header with the CP tile and CHARA with Pinnacle (to the public home) and a quiet Log out, one column of 35 rem centred with 24 px of top space on a phone, 48 px from `sm` and 64 px from `lg`, and the line of legal links. `OnboardingPanel` is one step: the steps, one h1 with one calm line, then the form; a white card (16 px radius, 40 px padding, the card shadow) from 640 px, the page itself on a phone, rising once (`animate-rise`). Below 640 px the submit button of a step is sticky at the foot of the screen, 12 px above the edge, on a 12 px band of the page colour, and `html` keeps 6 rem of scroll padding while an onboarding step is shown, so a field reached with Tab is never under the button (WCAG 2.4.11); these two rules are the only CSS of `components/onboarding/onboarding.css`, loaded with the layout.

### 10.2 Steps

`OnboardingSteps` takes the account kind and the index of the current step: employer Company, Security, Ready; worker Your profile, Ready. A 28 px circle per step and a hairline between them: done is the gold `--brand` circle with a dark check and a gold line after it, current the near-black `--primary` circle with its white number and a semibold label, upcoming an outline circle (`--muted-foreground`, above 3:1 on the card and the page for WCAG 1.4.11) with a muted number and label. Each item reads "Step 2 of 3: Security" to assistive technology, with "(done)" after a done step; the circles and lines are hidden from it. Below 640 px a visible "Step 2 of 3" (hidden from assistive technology, which reads the list) stands above the circles and only the current step is named. The account-type choice and the acceptance of a changed document have no steps.

### 10.3 Pages

- Company step: "Tell us about your company", the form in two `fieldset`s with an eyebrow legend in `muted-foreground`, Company and Registration (a hairline and 32 px above the second); the country preselected from the browser's region (`countryFromAcceptLanguage` in `lib/i18n/locale.ts`); one button, Continue.
- Passport step: "Create your CHARA Passport" and one line on why; the existing form.
- Security step: "Secure your account", why in one line, how in one line, then the existing `EnrolmentStartForm` (QR code, setup key, code) with the welcome screen as `next`.
- Welcome: "Welcome to Chara Pinnacle, <name>", one sentence and `WelcomeTiles`: link tiles of at least 80 px with a title, a line and an arrow that moves 2 px on hover; the first tile is drawn as the primary button (near-black), the others as white cards whose border darkens on hover. Shown once (`lib/welcome-cookie.ts`): the action that finishes the last step (`createPassport`, or `verifyEnrolment` for the owner of the first organisation) sets the cookie `chara_welcome`, and the proxy removes it on the next request that carries it, so a reload, a direct visit or a later sign-in goes to the dashboard. Back after a tile restores the page from the browser's history.

### 10.4 Verification

`tests/e2e/onboarding-journey.spec.ts` (both journeys with the state of every step and `aria-current`, the focused layout, two-step verification before billing, team and applicants, resume half-way, the country by keyboard and from the browser's region, the welcome screen once, the sticky button on every step and the focus not hidden at 375 px, axe and no sideways scrolling at 1280 and 360 px on every screen, the account-type choice and the re-acceptance of a changed document included), the updated `employer-registration`, `employer-dashboard`, `candidate-passport-create`, `confirm`, `google-sign-in`, `consent-versions`, `app-shell-navigation`, `smoke-journeys`, `public-site-design` and `accessibility-sweep` specs; Vitest `onboarding-components.test.tsx`, `onboarding-pages.test.tsx`, `welcome-cookie.test.ts`, `proxy.test.ts`, `locale.test.ts`, `routes.test.ts` and the action tests. First-load JavaScript (`route-bundle-stats.json`): `/[lang]/onboarding` 745,053 bytes, `/[lang]/onboarding/security` 716,733, `/[lang]/onboarding/welcome` 541,672 (no client code of its own; `/[lang]/mfa` in the signed-in shell is 733,789). Screenshots before and after at 1440, 1280, 768 and 375 px: `docs/phase-1/client/evidence/U68/` (not in git).

## 11. The home page as a product page (U70, U71)

The owner brief of 13 October 2026 (OPEN_QUESTIONS.md D88): the precision of a carefully designed software product, not a recruitment landing page; only what the product does; the client's structure document followed within Phase 1. The audit and the root causes it fixes are in `docs/phase-1/client/audit/HOME_AUDIT_U71.md` (not in git).

- **Order.** Header (the shared solid header, unchanged); hero; Who are you?; Workers and employers, connected; the CHARA Passport; Global Workforce Network (only when a live figure reaches `CREDIBLE_MINIMUM`); the closing call; the footer. No vacancy list, no tile, no chip: the search is the way to the vacancies.
- **One surface, one family.** The page is the light page of every other public page; the only dark surface is the closing call (`dark bg-inverse`), which sits on the dark footer above a hairline. Every heading is Geist semibold: `text-hero` for the h1, `text-section` for the section headings and the figures, `text-h1` for the two user types, `text-h3` for a step. No serif, no home-only CSS file, no selector that repaints the header.
- **Grid and rhythm.** Every section is `Band` (`components/home/band.tsx`): a hairline above, the `PageContainer` column (72 rem, 16 and 24 px gutters) and 80 px (112 px from `sm`) above and below. Inside, 8 px steps: 48 or 64 px between a heading block and its content, 24 to 40 px inside a block. The passport section uses the 12-column grid (5 and 6 columns, one apart); Who are you? is two columns from 768 px with a vertical hairline, a subgrid aligning the lines, the steps and the buttons of both sides.
- **Surfaces and colour.** Hairlines (`border`) instead of boxes; the only cards are the two real dashboard cards of the product picture; radii and the one shadow (`shadow-card`, on the search bar and those cards) come from the tokens; no gradient, no glow, no photograph. Gold appears on the focus ring (bronze on light), the primary button of the closing call, the eyebrow CHARA Passport (`brand-ink`) and the bars of the stage table.
- **Hero.** The client's headline and line (max 44 ch, balanced), the What and Where search (`HeroSearch`: one white bar with a hairline and `shadow-card`, two 48 px fields with a 20 px icon standing in for the label, the 48 px primary button), and Hiring? with Post a Job as a secondary button where the header offers it (`getPostJobHref`).
- **Who are you?** Employer then Worker, as the client's structure orders them, each with the client's line, the four steps of How Chara Pinnacle works from `lib/public/steps.ts` (the How it works page uses the same list), one fact the product enforces (two-step verification for owners and administrators; workers never pay) and one button to its sign-up. A link leads to the full How Chara Pinnacle works page.
- **Product picture.** `StageTable` and `RecentApplications`, the components of the employer and worker dashboards, with fictional totals and three fictional applications dated relative to the request, in an `inert` and `aria-hidden` wrapper inside a `figure` whose caption ("Screens of Chara Pinnacle, shown with fictional data.") is the one thing assistive technology reads. A change to the dashboards changes the picture with them.
- **Motion.** The hero text rises once (`animate-rise`); colour transitions on hover; nothing moves on scroll and nothing lifts. Reduced motion stops the rise.
- **Budgets.** The first-load JavaScript of `/[lang]` fell from 543,145 to 542,482 of 600,000 bytes (the reveal client component is gone, no client code was added); no image is requested.

Verification: `tests/e2e/home-layout.spec.ts` (no JavaScript, reduced motion with axe at 1280 and 360 px, no layout shift and nothing waiting for the scroll, the shared header at 1440, 768 and 375 px, one type family at 64 and 40 px and the same font preloads as Pricing, no picture or style attribute or CSP report, 320 to 1920 px, 44 px targets, the inert picture, focus rings, no movement on hover), `tests/e2e/home-product.spec.ts` (hero and order, nothing of a later phase or of the removed claims and no vacancy link, What and Where with and without JavaScript, the empty search, Who are you? against How it works and its sign-ups, the product picture, the passport, the closing call, the footer without photo credits, the keyboard path), `live-statistics.spec.ts` (the four tiles from 100 and their place), `design-system.spec.ts` (the type scale and the closing call buttons), `tests/unit/home-components.test.tsx`, `statistics-block.test.tsx`, `statistics-tiles.test.ts`, `tokens.test.ts`; screenshots at 1440, 1280, 1024, 768 and 375 px before and after, whole page and each section, in `docs/phase-1/client/evidence/U71/` (not in git).
