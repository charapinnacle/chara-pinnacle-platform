# Runbook: design system

NFR-U1 and NFR-U2, audit findings DS-01 to DS-03, CODE-01, CODE-02, CODE-05 and UX-07 (unit U56). The tokens live in `apps/web/app/globals.css`; the shared components in `apps/web/components/layout`, `components/feedback` and `components/forms`. `components/ui` holds the shadcn/ui primitives: they are never edited, a component wraps them.

## 1. Tokens

The brand colours are placeholders until CHARA supplies them (OPEN_QUESTIONS.md, W6): every colour is a token, so the real palette is a change to the `:root` block of `globals.css` only.

### Type scale

One utility per size, from `@theme` in `globals.css`. `display` and `h1` step up at the `sm` breakpoint (40 rem) through a `:root` override, so a page never writes a responsive size by hand. A heading utility also sets its weight and tracking, so write `text-h2`, not `text-h2 font-semibold`.

| Utility | Size | Line height | Use |
|---|---|---|---|
| `text-display` | 2.25 rem, 3 rem from `sm` | 1.15 | The title of the home page and of content and legal pages (`PageHeader size="display"`) |
| `text-h1` | 1.5 rem, 1.75 rem from `sm` | 1.25 | The one title of a page (`PageHeader`), the card title of the auth pages |
| `text-h2` | 1.125 rem | 1.55 | Section and card headings (including a section heading on the home page), dialog titles |
| `text-h3` | 1 rem | 1.5 | Headings inside a section |
| `text-lead` | 1.125 rem | 1.75 | The tagline and the lead paragraph under a display title (the display variant of `PageHeader` does it for its description) |
| `text-figure` | 1.875 rem | 1.2 | A number shown on its own (a count on a summary card) |
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
| `shadow-card` | one soft shadow | The single elevation: raised cards, the auth card, dialogs and toasts. There is no second shadow |
| `--focus-ring`, `--focus-ring-offset` | `2px solid var(--ring)`, 2 px | The visible focus of every link, button, field and summary. It is drawn outside the cascade layers on purpose (see `tokens.test.ts`) |

### Colours

Core tokens: `background`, `foreground`, `card`, `primary` (with `-hover`, `-active`, `-foreground`), `secondary`, `muted`, `muted-foreground`, `accent`, `destructive` (with `-hover`, `-active`, `-foreground`, `-surface`), `border`, `input`, `ring`.

Status tokens, five statuses with three tokens each: `success`, `warning`, `danger`, `info`, `neutral`, as `--<status>-foreground` (text and icon), `--<status>-background` and `--<status>-border`. Tailwind utilities: `text-success-foreground`, `bg-success-background`, `border-success-border`, and so on. `danger` is the `destructive` pair, `info` the `accent` pair and `neutral` the `secondary` text on a grey surface.

`:root` is the light theme. The `.dark` block is a complete dark theme that is tested but not applied, because nothing puts the `dark` class on the root element yet (no theme switch exists), so the interface is unchanged. When a switch is built, it only has to set that class.

Contrast, computed by the WCAG formula from the tokens (`tests/unit/support/tokens.ts`; the same file is the test helper). Text pairs need 4.5:1, component boundaries (input, focus ring) 3:1. The border of a status is decorative: the label always says the status in words, colour never carries the meaning alone; the test only keeps it visible (at least 1.5:1 against its background and the card).

| Pair | Light | Dark |
|---|---|---|
| foreground on background / card | 18.06 / 19.13 | 17.03 / 15.78 |
| muted-foreground on background / card | 5.92 / 6.27 | 8.29 / 7.68 |
| primary-foreground on primary / hover / active | 7.26 / 9.45 / 11.98 | 7.74 / 9.47 / 11.67 |
| destructive-foreground on destructive / hover / active | 6.38 / 7.84 / 9.84 | 7.88 / 9.42 / 11.80 |
| success-foreground on success-background / card / background | 8.01 / 8.63 / 8.15 | 9.83 / 11.82 / 12.76 |
| warning-foreground on warning-background / card / background | 7.90 / 8.67 / 8.18 | 10.17 / 12.29 / 13.26 |
| danger-foreground on danger-background / card / background | 6.06 / 6.57 / 6.20 | 6.41 / 7.16 / 7.73 |
| info-foreground on info-background / card / background | 12.10 / 13.86 / 13.08 | 10.19 / 12.31 / 13.29 |
| neutral-foreground on neutral-background / card / background | 14.04 / 16.01 / 15.11 | 11.89 / 13.99 / 15.10 |
| foreground on each status background (Notice text) | 16.70 to 17.76 | 13.06 to 14.12 |
| muted-foreground on each status background | 5.47 to 5.82 | 6.36 to 6.88 |
| input on card / background (3:1) | 3.64 / 3.44 | 4.87 / 5.25 |
| ring on card / background (3:1) | 7.47 / 7.05 | 7.06 / 7.62 |

The lowest text pair in the light theme is `muted-foreground` on `info-background`, 5.47:1. `tests/unit/tokens.test.ts` checks every pair in both themes and fails when a token is changed below the limit.

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

## 4. Verification

`npm test` (the tokens, the components and the contrast helper are in `tokens.test.ts`, `design-system-components.test.tsx`, `form-error-summary.test.tsx`, `utils.test.ts`, `toast.test.tsx`), `tests/e2e/design-system.spec.ts` (the destructive style, the spinner and the status badges in a browser), and the axe checks of the existing browser tests, which run on every screen the tokens reach.
