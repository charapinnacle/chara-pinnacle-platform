import { signInStaff } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { execute, executeAsync, literal } from "./support/db";
import { createCommittedUser } from "./support/login";
import { expect, test } from "./support/test";

const FUNCTION = "public.list_platform_staff(integer, bigint)";

// The factor table is locked for the whole database in the first test, the staff function is withdrawn from the API role
// in the second, and the third fills the staff table with rows that push every other test's rows off the first page, so
// this file has a project of its own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  execute(`grant execute on function ${FUNCTION} to authenticated`);
});

test.describe("the staff page when the database is slow or fails and when the list is long", () => {
  test("FR-A7 AC10: the list shows a skeleton while it waits, and the table replaces it", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin");
    const held = executeAsync("begin; lock table auth.mfa_factors in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await page.goto("/en/admin/staff", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "Staff", level: 1 })).toBeVisible();
    await expect(page.getByRole("status").getByText("Loading")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);

    await expect(page.getByRole("table", { name: "Platform staff roles, newest first" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status").getByText("Loading")).toHaveCount(0);
    await held;
  });

  test("FR-A7 AC10: a list that cannot be read shows an error with a toast and Try again, says nothing of the cause, and Try again reads it again", async ({
    page,
  }) => {
    await signInStaff(page, "admin", "/en/admin");
    execute(`revoke execute on function ${FUNCTION} from authenticated`);

    await page.goto("/en/admin/staff");
    await expect(page.getByRole("heading", { name: "The page could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.").first()).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText(/permission denied|list_platform_staff/)).toHaveCount(0);

    execute(`grant execute on function ${FUNCTION} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("table", { name: "Platform staff roles, newest first" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  });

  test("FR-A7 AC10: a list longer than a page is paged newest first, with a link to the older entries and one back", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin/staff");
    const person = await createCommittedUser("company");
    execute(
      `insert into public.platform_staff (user_id, role, granted_at, revoked_at)
       select ${literal(person.id)}, 'verification_reviewer', now() - interval '2 days', now() - interval '1 day' from generate_series(1, 30)`,
    );
    await page.reload();
    const rows = page.getByRole("table", { name: "Platform staff roles, newest first" }).getByRole("row").filter({ has: page.getByRole("cell") });
    await expect(rows).toHaveCount(25);
    await expect(rows.filter({ hasText: person.email })).toHaveCount(25);
    await expect(page.getByRole("link", { name: "Back to the newest entries" })).toHaveCount(0);

    await page.getByRole("link", { name: "Show older entries" }).click();
    await expect(page).toHaveURL(/\/en\/admin\/staff\?after=\d+$/);
    await expect(rows.filter({ hasText: person.email })).toHaveCount(5);
    await expect(rows.first()).toContainText(person.email);
    await expectNoAxeViolations(page);
    await page.getByRole("link", { name: "Back to the newest entries" }).click();
    await expect(page).toHaveURL("/en/admin/staff");
    await expect(rows.filter({ hasText: person.email })).toHaveCount(25);
  });
});
