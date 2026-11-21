import type { Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { signInStaff } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { choose } from "./support/combobox";
import { execute, executeAsync, literal, query } from "./support/db";
import { createCommittedUser, enrollTotp } from "./support/login";
import { logIn } from "./support/login-page";
import { staffUser } from "./support/mfa";
import { expect, test } from "./support/test";

// The direct-hiring rules page of the console (FR-Q5 AC10; AC1 and AC12 in the browser; NFR-O5). No other spec reads the
// rules: the tests empty the table, lock it for a moment and withdraw the list and save functions from the API role, so
// they run one after the other and put everything back.

const PAGE = "/en/admin/direct-hiring-rules";
const LIST = "public.admin_list_direct_hiring_rules()";
const SAVE = "public.admin_upsert_direct_hiring_rule(text, text, text, text, text, text)";
const REASON = "Rule set after the legal opinion of November.";
const PH_NOTICE = "Hiring workers who live in the Philippines needs a licensed recruitment partner.";
const EMPTY = "No rules yet, direct hiring is allowed with the general notice";

function seedRule(source: string, destination: string | null, rule: string, notice: string, reference: string, daysAgo: number): void {
  execute(`insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref, created_at, updated_at)
    values (${literal(source)}, ${destination ? literal(destination) : "null"}, ${literal(rule)}, ${literal(notice)}, ${literal(reference)},
      now() - interval '${daysAgo} days', now() - interval '${daysAgo} days')`);
}

function rules(): string[] {
  return query<{ r: string }>(
    `select source_country || '>' || coalesce(destination_country, '*') || ':' || rule || ':' || legal_opinion_ref as r
     from public.direct_hiring_rules order by 1`,
  ).map((row) => row.r);
}

function audits(): { action: string; reason: string }[] {
  return query<{ action: string; reason: string }>(
    `select action, metadata ->> 'reason' as reason from audit.log
     where action like 'direct\\_hiring\\_rule.%' and created_at > now() - interval '10 minutes' order by id`,
  );
}

function table(page: Page) {
  return page.getByRole("region", { name: "Direct-hiring rules", exact: true });
}

function row(page: Page, source: string, destination: string) {
  return table(page).getByRole("row").filter({ hasText: source }).filter({ hasText: `to ${destination}` });
}

test.describe("the direct-hiring rules of the console (FR-Q5)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(() => {
    execute("delete from public.direct_hiring_rules");
  });

  test.afterEach(() => {
    execute(`grant execute on function ${LIST} to authenticated; grant execute on function ${SAVE} to authenticated;
      delete from public.direct_hiring_rules;`);
  });

  test("AC10: an administrator at aal1 is sent to two-step verification, Trust & Safety and a candidate get 404; the empty list says the default applies", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await logIn(page, await createCommittedUser("worker"));
    await expect(page).not.toHaveURL(/\/en\/login/);
    expect((await page.goto(PAGE))?.status()).toBe(404);
    await page.context().clearCookies();

    await signInStaff(page, "trust_safety");
    await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Direct-hiring rules" })).toHaveCount(0);
    expect((await page.goto(PAGE))?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.context().clearCookies();

    const admin = await staffUser("admin");
    await enrollTotp(admin);
    await logIn(page, admin);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto(PAGE);
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent(PAGE)}`);
    await expect(page.getByRole("heading", { name: "Verify it is you" })).toBeVisible();
    await page.context().clearCookies();

    await signInStaff(page, "admin");
    await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Direct-hiring rules" }).click();
    await expect(page).toHaveURL(PAGE);
    await expect(page.getByRole("heading", { name: "Direct-hiring rules", level: 1 })).toBeVisible();
    await expect(page.getByText(EMPTY, { exact: true })).toBeVisible();
    await expect(table(page)).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
  });

  test("AC10: the list shows each rule with its age and review flag; a rule is added by keyboard, edited and deleted after confirming, each audited", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    seedRule("NP", null, "licensed_partner_required", "Hiring from Nepal needs a licensed recruitment partner.", "LO-2025-09 NP", 400);
    seedRule("NG", "DE", "blocked", "Direct hiring from Nigeria to Germany is not available.", "LO-2026-10 NG-DE", 10);
    // A change whose administrator no longer exists has no actor in the audit log.
    execute(`select audit.record('direct_hiring_rule.created', 'direct_hiring_rule', gen_random_uuid()::text,
      jsonb_build_object('after', jsonb_build_object('source_country', 'NP', 'rule', 'licensed_partner_required', 'notice', 'n', 'legal_opinion_ref', 'LO-2025-09 NP'), 'reason', ${literal(REASON)}))`);
    await signInStaff(page, "admin", PAGE);

    const nepal = row(page, "Nepal", "All destinations");
    await expect(nepal).toContainText("Licensed partner required");
    await expect(nepal).toContainText("Hiring from Nepal needs a licensed recruitment partner.");
    await expect(nepal).toContainText("LO-2025-09 NP");
    await expect(nepal).toContainText("Last changed 400 days ago");
    await expect(nepal).toContainText("Review due");
    const nigeria = row(page, "Nigeria", "Germany");
    await expect(nigeria).toContainText("Direct hiring blocked");
    await expect(nigeria).toContainText("Last changed 10 days ago");
    await expect(nigeria).not.toContainText("Review due");
    await expectAccessibleAtBothWidths(page);
    // At about 820 px the columns keep their width and the table scrolls in its region, never the page.
    await page.setViewportSize({ width: 820, height: 900 });
    const table = page.getByRole("region", { name: "Direct-hiring rules", exact: true });
    expect(await table.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(await nepal.getByText("Hiring from Nepal needs a licensed recruitment partner.").evaluate((cell) => cell.getBoundingClientRect().width >= 176)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });

    const before = audits().length;
    const add = page.getByRole("button", { name: "Add rule" });
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add a rule" });
    await expect(dialog.getByText("This is not legal advice to anyone.", { exact: false })).toBeVisible();
    await choose(page, "Source country", "Philippines");
    await expect(dialog.getByRole("combobox", { name: "Destination country" })).toHaveValue("");
    await dialog.getByRole("combobox", { name: "Rule" }).selectOption("licensed_partner_required");
    await dialog.getByRole("textbox", { name: "Notice" }).focus();
    await page.keyboard.type(PH_NOTICE);
    await dialog.getByRole("textbox", { name: "Reason for the change" }).focus();
    await page.keyboard.type(REASON);
    await dialog.getByRole("button", { name: "Save rule" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByText("Enter the legal opinion reference").first()).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Legal opinion reference" })).toHaveAttribute("aria-invalid", "true");
    expect(rules()).toEqual(["NG>DE:blocked:LO-2026-10 NG-DE", "NP>*:licensed_partner_required:LO-2025-09 NP"]);
    await expectNoAxeViolations(page);

    await dialog.getByRole("textbox", { name: "Legal opinion reference" }).focus();
    await page.keyboard.type("LO-2026-11 PH");
    await page.keyboard.press("Enter");
    await expect(page.getByText("The rule is saved", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    const philippines = row(page, "Philippines", "All destinations");
    await expect(philippines).toContainText("Licensed partner required");
    await expect(philippines).toContainText("LO-2026-11 PH");
    await expect(philippines).toContainText("Last changed today");
    expect(rules()).toContain("PH>*:licensed_partner_required:LO-2026-11 PH");
    expect(audits().slice(before)).toEqual([{ action: "direct_hiring_rule.created", reason: REASON }]);
    // The notice closes by itself, so the one of the next save is the only one on the page.
    await expect(page.getByText("The rule is saved", { exact: true })).toBeHidden();

    await philippines.getByRole("button", { name: "Edit the rule for Philippines, All destinations" }).click();
    const edit = page.getByRole("dialog", { name: "Edit the rule for Philippines, All destinations" });
    await expect(edit.getByRole("combobox", { name: "Source country" })).toHaveCount(0);
    await expect(edit.getByRole("textbox", { name: "Notice" })).toHaveValue(PH_NOTICE);
    await edit.getByRole("combobox", { name: "Rule" }).selectOption("blocked");
    await edit.getByRole("textbox", { name: "Legal opinion reference" }).fill("LO-2026-12 PH");
    await edit.getByRole("textbox", { name: "Reason for the change" }).fill(REASON);
    await expectNoAxeViolations(page);
    await edit.getByRole("button", { name: "Save rule" }).click();
    // The dialog sits in the row with every rule among its options: only its closing says this save is done.
    await expect(edit).toBeHidden();
    await expect(page.getByText("The rule is saved", { exact: true })).toBeVisible();
    await expect(row(page, "Philippines", "All destinations")).toContainText("Direct hiring blocked");
    expect(rules()).toContain("PH>*:blocked:LO-2026-12 PH");
    const changes = page.getByRole("region", { name: "Changes of the direct-hiring rules, newest first" });
    await expect(changes.getByRole("row").nth(1)).toContainText(
      "Changed PH -> all destinations: rule Licensed partner required -> Direct hiring blocked; legal opinion LO-2026-11 PH -> LO-2026-12 PH",
    );
    await expect(changes.getByRole("row").nth(1)).toContainText(REASON);
    await expect(changes.getByRole("row").filter({ hasText: "Added NP -> all destinations" })).toContainText("Former administrator");

    await row(page, "Philippines", "All destinations").getByRole("button", { name: "Edit the rule for Philippines, All destinations" }).click();
    await edit.getByRole("textbox", { name: "Reason for the change" }).fill(REASON);
    await edit.getByRole("button", { name: "Save rule" }).click();
    await expect(edit.getByText("Nothing changed. To record a review, update the legal opinion reference.").first()).toBeVisible();
    await expect(edit).toBeVisible();
    expect(audits().slice(before).map((entry) => entry.action)).toEqual(["direct_hiring_rule.created", "direct_hiring_rule.updated"]);
    await edit.getByRole("button", { name: "Cancel" }).click();

    await row(page, "Philippines", "All destinations").getByRole("button", { name: "Delete the rule for Philippines, All destinations" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete the rule for Philippines, All destinations" });
    await expect(confirm).toContainText("Philippines returns to the default: direct hiring allowed with the general notice");
    await confirm.getByRole("button", { name: "Delete rule" }).click();
    await expect(confirm.getByText("Give a reason of at least 10 characters").first()).toBeVisible();
    await confirm.getByRole("textbox", { name: "Reason for the change" }).fill(REASON);
    await expectNoAxeViolations(page);
    await confirm.getByRole("button", { name: "Delete rule" }).click();
    await expect(page.getByText("The rule is deleted", { exact: true })).toBeVisible();
    await expect(row(page, "Philippines", "All destinations")).toHaveCount(0);
    expect(rules()).toEqual(["NG>DE:blocked:LO-2026-10 NG-DE", "NP>*:licensed_partner_required:LO-2025-09 NP"]);
    expect(audits().slice(before).map((entry) => entry.action)).toEqual([
      "direct_hiring_rule.created",
      "direct_hiring_rule.updated",
      "direct_hiring_rule.deleted",
    ]);
    await expect(changes.getByRole("row").nth(1)).toContainText("Deleted PH -> all destinations: Direct hiring blocked");
  });

  test("AC10: a save that fails keeps the dialog and its values and shows a toast", async ({ page }) => {
    await signInStaff(page, "admin", PAGE);
    execute(`revoke execute on function ${SAVE} from authenticated`);
    await page.getByRole("button", { name: "Add rule" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a rule" });
    await choose(page, "Source country", "Philippines");
    await dialog.getByRole("combobox", { name: "Rule" }).selectOption("blocked");
    await dialog.getByRole("textbox", { name: "Notice" }).fill(PH_NOTICE);
    await dialog.getByRole("textbox", { name: "Legal opinion reference" }).fill("LO-2026-11 PH");
    await dialog.getByRole("textbox", { name: "Reason for the change" }).fill(REASON);
    await dialog.getByRole("button", { name: "Save rule" }).click();
    await expect(page.getByText("The rule was not saved", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Notice" })).toHaveValue(PH_NOTICE);
    await expect(dialog.getByRole("textbox", { name: "Legal opinion reference" })).toHaveValue("LO-2026-11 PH");
    expect(rules()).toEqual([]);
  });

  test("AC10: a skeleton shows while the rules load, and the list replaces it", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin");
    const held = executeAsync("begin; lock table public.direct_hiring_rules in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.goto(PAGE, { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "Direct-hiring rules", level: 1 })).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading" }).first()).toBeVisible();
    await expect(page.getByText(EMPTY, { exact: true })).toHaveCount(0);
    await expect(page.getByText(EMPTY, { exact: true })).toBeVisible({ timeout: 15_000 });
    await held;
  });

  test("AC10: rules that cannot be read show an error with a toast and Try again, which reads them again", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin");
    execute(`revoke execute on function ${LIST} from authenticated`);
    await page.goto(PAGE);
    await expect(page.getByRole("heading", { name: "The page could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.").first()).toBeVisible();
    await expect(page.getByText(/permission denied|admin_list_direct_hiring_rules/)).toHaveCount(0);

    execute(`grant execute on function ${LIST} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText(EMPTY, { exact: true })).toBeVisible();
  });
});
