# Runbook: design system

NFR-U1 and NFR-U2, audit findings DS-01 to DS-03, CODE-01, CODE-02, CODE-05 and UX-07 (unit U56); the brand, the app layout and the dashboards of unit U59 (audit findings UX-03, UX-04, UX-10). The tokens live in `apps/web/app/globals.css`; the shared components in `apps/web/components/layout`, `components/feedback`, `components/forms` and `components/dashboard`. `components/ui` holds the shadcn/ui primitives: they are never edited, a component wraps them.

## 0. Design brief

CHARA sells into a design-sensitive European market. The product is calm, confident and typographic, in the Swiss and Nordic tradition (Linear, Stripe, Vercel, Personio, N26): it must never look like a template website.

- **Brand.** The owner's gold CP monogram on black (`docs/phase-1/client/brand/`, not in git; web copies in `apps/web/public/brand/` as PNG and WebP at 128 and 512 px, the favicon `app/icon.png`, `app/apple-icon.png` and `app/opengraph-image.png`, all cropped from it, never redrawn). The monogram sits only on black: its own tile in the headers and the sidebar, the dark footer and the dark panel of the sign-in pages. Next to it the wordmark CHARA in the UI typeface with wide tracking, and Pinnacle in small capitals in gold where there is room (sidebar, footer, sign-in panel).
- **Palette.** Near-black ink for text and the primary button, warm off-white for the page, white cards, hairline borders. Gold is the single accent and appears sparingly: the gold mark of the current sidebar item, the progress bars, the icon tiles, the underline of text links. Gold is never text on a light surface: `brand-ink`, a deep bronze, is (6.57:1). Status colours are semantic only (green, amber, red, blue, grey) and every status is also said in words.
- **Type.** Geist (variable, `latin` and `latin-ext` for European names), loaded with `next/font` from our own origin. Headings are large, tight and semibold; secondary text is quiet (`muted-foreground`); figures use tabular numbers (`tabular-nums`).
- **Space and surfaces.** An 8 px grid: 16 px gutters on a phone, 24 px on a tablet, 40 px on a desktop; 24 px between the blocks of a section and 32 px between sections (`gap-page`, `gap-section`). Cards have a 10 to 14 px radius, a hairline border and one very soft shadow; no heavy boxes.
- **Motion.** Purposeful and short: 150 ms for colour, 200 ms for movement, 240 ms for entrances, all `ease-brand` (an ease-out). Cards rise 6 px as they appear, the figure cards, panels and list rows of a dashboard one after the other (`animate-stagger`, 50 ms apart), menus fade and scale from 95 %, skeletons shimmer, progress bars fill. Every animation stops under `prefers-reduced-motion` (the base layer sets durations and delays to zero).
- **Copy and conduct.** Short, precise, friendly; GDPR-aware and honest (no dark patterns, no claim the data does not support). Dates are written in full (`formatDate`), short European dates (`formatShortDate`, 3 Oct 2026) in lists, relative times ("2 hours ago", `formatRelative`) beside the exact date in a `time` element. Money is `EUR 39.00` with the VAT note.
- **Accessibility.** WCAG 2.2 AA: every pair below is tested, focus is a 2 px bronze outline outside the cascade layers, targets are at least 40 px (44 px for touch controls), charts are tables with bars added for the eye only.

## 1. Tokens

Every colour is a token in the `:root` block of `globals.css`; the `.dark` block is the tested dark set (not applied).

### Type scale

One utility per size, from `@theme` in `globals.css`. `display` and `h1` step up at the `sm` breakpoint (40 rem) through a `:root` override, so a page never writes a responsive size by hand. A heading utility also sets its weight and tracking, so write `text-h2`, not `text-h2 font-semibold`.

| Utility | Size | Line height | Use |
|---|---|---|---|
| `text-display` | 2.25 rem, 3 rem from `sm` (tracking -0.035 em) | 1.15 | The title of the home page and of content and legal pages (`PageHeader size="display"`) |
| `text-h1` | 1.625 rem, 2 rem from `sm` (tracking -0.03 em) | 1.2 | The one title of a page (`PageHeader`), the card title of the auth pages |
| `text-h2` | 1.125 rem | 1.55 | Section and card headings (including a section heading on the home page), dialog titles |
| `text-h3` | 1 rem | 1.5 | Headings inside a section |
| `text-lead` | 1.125 rem | 1.75 | The tagline and the lead paragraph under a display title (the display variant of `PageHeader` does it for its description) |
| `text-figure` | 2 rem (tracking -0.03 em; add `tabular-nums`) | 1.15 | A number shown on its own (a count on a summary card) |
| `text-body` | 0.9375 rem | inherited | Running text in the application |
| `text-small` | 0.875 rem | 1.43 | Secondary text, labels, table headers |
| `text-caption` | 0.75 rem | 1.33 | The smallest text (a badge such as New) |

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

Brand tokens: `brand` (solid gold, C9973D, for marks, bars and icons, never text on light), `brand-ink` (bronze, text and icons in gold on a light surface), `inverse`, `inverse-foreground`, `inverse-muted` (the black surfaces: footer, sign-in panel).

Status tokens, five statuses with three tokens each: `success`, `warning`, `danger`, `info`, `neutral`, as `--<status>-foreground` (text and icon), `--<status>-background` and `--<status>-border`. Tailwind utilities: `text-success-foreground`, `bg-success-background`, `border-success-border`, and so on. `danger` is the `destructive` pair, `info` a quiet blue of its own (it no longer borrows the accent, which is gold now) and `neutral` the `secondary` text on a grey surface.

`:root` is the light theme. The `.dark` block is a complete dark theme (gold primary on ink) that is tested but not applied, because nothing puts the `dark` class on the root element yet (no theme switch exists). When a switch is built, it only has to set that class.

Contrast, computed by the WCAG formula from the tokens (`tests/unit/support/tokens.ts`; the same file is the test helper). Text pairs need 4.5:1, component boundaries (input, focus ring) 3:1. The border of a status is decorative: the label always says the status in words, colour never carries the meaning alone; the test only keeps it visible (at least 1.5:1 against its background and the card).

| Pair | Light | Dark |
|---|---|---|
| foreground on background / card | 18.68 / 19.67 | 17.51 / 16.44 |
| muted-foreground on background / card | 6.48 / 6.83 | 8.53 / 8.01 |
| primary-foreground on primary / hover / active | 18.58 / 14.64 / 11.43 | 9.75 / 11.60 / 13.69 |
| destructive-foreground on destructive / hover / active | 6.47 / 8.06 / 10.11 | 7.88 / 9.42 / 11.80 |
| brand-ink on background / card / accent | 6.57 / 6.92 / 6.07 | 10.47 / 9.83 / 8.03 |
| accent-foreground on accent | 9.62 | 10.50 |
| inverse-foreground / inverse-muted on inverse | 18.04 / 8.53 | 18.75 / 8.87 |
| brand on inverse | 7.48 | 7.78 |
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
| `BrandMark`, `BrandLink`, `Wordmark` | `components/layout/brand.tsx` | The monogram tile and the wordmark; `BrandLink` is the way home (its name is the wordmark) | The monogram only on black. Never a second logo |
| `AppShell` | `components/layout/app-shell.tsx` | The frame of the signed-in area and the console: from 1024 px a 16 rem sidebar (brand, navigation, identity at its foot), a top bar with the account menu (and below 1024 px the brand and the menu of `AppNav`), the page in `max-w-content`, the legal links at the bottom | Pages put their content straight in it: lists and dashboards use the whole width; a form or a long text keeps `max-w-3xl`, left aligned |
| `AppSidebar`, `AdminSidebar`, `SidebarLink`, `SidebarIdentity` | `components/layout`, `components/admin` | The sidebar navigation (the same model as the header: `lib/app/navigation.ts`, `lib/admin/navigation.ts`) with a lucide icon per entry, the current page raised with a gold mark, and the organisation (the switcher for several) or the account at the foot | An entry is added to the model, with its `icon`; the icon maps are typed so a missing icon fails the build |
| `SummaryCard` | `components/dashboard/summary-card.tsx` | A figure of a dashboard: label, optional `hint` (part of the name), optional `detail`, the figure, an icon tile and View all; the whole card is the link to the list it counts, named "label: value" | Every figure comes from a query and states its unit and period in the label |
| `StageTable`, `StageBar` | `components/dashboard` | The stages of the pipeline as a table with a bar beside each number (SVG attributes, no inline style, hidden from assistive technology), a total, and a link per stage when a filtered list exists | The table is the chart: no chart library |
| `QuickActions` | `components/dashboard/quick-actions.tsx` | The pages a person uses most, as secondary buttons with icons | Never a stack of plain text links |
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

## 5. Verification

`npm test` (the tokens, the components and the contrast helper are in `tokens.test.ts`, `design-system-components.test.tsx`, `form-error-summary.test.tsx`, `utils.test.ts`, `toast.test.tsx`), `tests/e2e/design-system.spec.ts` (the destructive style, the spinner and the status badges in a browser), and the axe checks of the existing browser tests, which run on every screen the tokens reach.
