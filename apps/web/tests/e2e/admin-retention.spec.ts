import type { Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { signInStaff } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { execute, executeAsync, query } from "./support/db";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { expect, test } from "./support/test";

// The retention periods page of the console (FR-S3 AC10, AC1 in the browser; NFR-O5). The tests change the conversations
// period, which no other spec reads, lock the periods table for a moment and withdraw the two editor functions from the
// API role, so they run one after the other and put everything back.

const LIST = "public.admin_list_retention_policies()";
const SAVE = "public.admin_set_retention_policy(text, integer, text)";
const REASON = "Shorter period agreed with CHARA.";

function days(entity: string): number {
  return query<{ d: number }>(`select days as d from private.retention_policies where entity = '${entity}'`)[0].d;
}

function updates(): number {
  return query<{ n: number }>(`select count(*)::int as n from audit.log where action = 'retention_policy.updated' and entity_id = 'conversations'`)[0].n;
}

function row(page: Page, label: string) {
  return page.getByRole("region", { name: "Retention periods" }).getByRole("row").filter({ has: page.getByText(label, { exact: true }) });
}

test.describe("the retention periods of the console (FR-S3)", () => {
  test.describe.configure({ mode: "serial" });

  test.afterEach(() => {
    execute(`grant execute on function ${LIST} to authenticated; grant execute on function ${SAVE} to authenticated;
      update private.retention_policies set days = 730 where entity = 'conversations';`);
  });

  test("AC10: the Trust & Safety Administrator and a candidate are refused; the administrator sees every period in days and months", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await logIn(page, await createCommittedUser("worker"));
    await expect(page).not.toHaveURL(/\/en\/login/);
    expect((await page.goto("/en/admin/retention"))?.status()).toBe(404);
    await page.context().clearCookies();

    await signInStaff(page, "trust_safety");
    await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Retention periods" })).toHaveCount(0);
    expect((await page.goto("/en/admin/retention"))?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.context().clearCookies();

    await signInStaff(page, "admin");
    await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Retention periods" }).click();
    await expect(page).toHaveURL("/en/admin/retention");
    await expect(page.getByRole("heading", { name: "Retention periods", level: 1 })).toBeVisible();
    const conversations = row(page, "Conversations");
    await expect(conversations.getByRole("cell").nth(1)).toHaveText("730");
    await expect(conversations.getByRole("cell").nth(2)).toHaveText("24 months");
    await expect(conversations).toContainText("Applies with messaging (release 2c).");
    for (const label of ["Partner responses", "Candidate submissions", "Closed requirements", "Contact requests", "Replaced licence evidence", "Job order statistics"]) {
      await expect(row(page, label)).toHaveCount(1);
    }
    await expect(row(page, "Contact requests").getByRole("cell").nth(1)).toHaveText("365");
    await expect(row(page, "Closed requirements")).toContainText("with its invitations, responses and submissions");
    await expect(row(page, "Replaced licence evidence").getByRole("cell").nth(2)).toHaveText("1 month");
    const audit = row(page, "Audit log");
    await expect(audit.getByRole("cell").nth(1)).toHaveText("2,191");
    await expect(audit).toContainText("Changed by migration only");
    await expect(audit.getByRole("button")).toHaveCount(0);
    const inactive = row(page, "Inactive candidate accounts");
    await expect(inactive.getByRole("cell").nth(1)).toHaveText("730");
    await expect(inactive).toContainText("Changed by migration only");
    await expect(inactive.getByRole("button")).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
  });

  test("AC10: 365 days with a reason is saved by keyboard with a toast; 0 and 40,000 days show a field error and save nothing", async ({ page }) => {
    test.setTimeout(120_000);
    await signInStaff(page, "admin", "/en/admin/retention");
    const before = updates();
    const change = row(page, "Conversations").getByRole("button", { name: "Change Conversations" });
    await change.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Conversations" });
    const period = dialog.getByRole("textbox", { name: "Period in days" });
    const reason = dialog.getByRole("textbox", { name: "Reason for the change" });
    await expect(period).toHaveValue("730");

    await period.fill("0");
    await reason.fill(REASON);
    await dialog.getByRole("button", { name: "Review change" }).click();
    await expect(dialog.getByText("Enter a whole number of days from 1 to 3,650").first()).toBeVisible();
    await expect(period).toHaveAttribute("aria-invalid", "true");
    await period.fill("40000");
    await dialog.getByRole("button", { name: "Review change" }).click();
    await expect(dialog.getByText("Enter a whole number of days from 1 to 3,650").first()).toBeVisible();
    expect(days("conversations")).toBe(730);
    expect(updates()).toBe(before);
    await expectNoAxeViolations(page);

    await period.fill("365");
    await period.press("Enter");
    await expect(dialog.getByText("Conversations: 730 days (24 months) -> 365 days (12 months)")).toBeVisible();
    await expect(dialog.getByRole("status")).toContainText("deleted at the next daily retention run");
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Save period" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Conversations is saved", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(row(page, "Conversations").getByRole("cell").nth(1)).toHaveText("365");
    await expect(row(page, "Conversations").getByRole("cell").nth(2)).toHaveText("12 months");
    expect(days("conversations")).toBe(365);
    expect(
      query<{ before: string; after: string; reason: string }>(
        `select metadata ->> 'before' as before, metadata ->> 'after' as after, metadata ->> 'reason' as reason from audit.log
         where action = 'retention_policy.updated' and entity_id = 'conversations' order by id desc limit 1`,
      ),
    ).toEqual([{ before: "730", after: "365", reason: REASON }]);
    expect(updates()).toBe(before + 1);
  });

  test("AC10: a save that fails keeps the dialog and its values and shows a toast", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin/retention");
    execute(`revoke execute on function ${SAVE} from authenticated`);
    await row(page, "Conversations").getByRole("button", { name: "Change Conversations" }).click();
    const dialog = page.getByRole("dialog", { name: "Conversations" });
    await dialog.getByRole("textbox", { name: "Period in days" }).fill("500");
    await dialog.getByRole("textbox", { name: "Reason for the change" }).fill(REASON);
    await dialog.getByRole("button", { name: "Review change" }).click();
    await dialog.getByRole("button", { name: "Save period" }).click();
    await expect(page.getByText("The retention period was not saved", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Period in days" })).toHaveValue("500");
    await expect(dialog.getByRole("textbox", { name: "Reason for the change" })).toHaveValue(REASON);
    expect(days("conversations")).toBe(730);
  });

  test("AC10: a skeleton shows while the periods load, and the table replaces it", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin");
    const held = executeAsync("begin; lock table private.retention_policies in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.goto("/en/admin/retention", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "Retention periods", level: 1 })).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Retention periods" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
    await held;
  });

  test("AC10: periods that cannot be read show an error with a toast and Try again, which reads them again", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin");
    execute(`revoke execute on function ${LIST} from authenticated`);
    await page.goto("/en/admin/retention");
    await expect(page.getByRole("heading", { name: "The page could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.").first()).toBeVisible();
    await expect(page.getByText(/permission denied|admin_list_retention_policies/)).toHaveCount(0);

    execute(`grant execute on function ${LIST} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("table", { name: "Retention periods" })).toBeVisible();
  });
});
