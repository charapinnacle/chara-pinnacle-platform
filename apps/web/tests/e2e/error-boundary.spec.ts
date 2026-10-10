import { accountButton, mainNavigation, signedInPage } from "./support/app-shell";
import { expectNoAxeViolations } from "./support/axe";
import { execute } from "./support/db";
import { createCommittedUser } from "./support/login";
import { newTeam } from "./support/team";
import { expect, test } from "./support/test";

const PASSPORT_LIMITS = "public.passport_limits()";
const MEMBERS_TABLE = "public.organization_members";
const SIGNUP_DOCUMENTS = "public.signup_documents(public.account_kind)";

// A function is withdrawn from the API roles for the whole database while these tests run, so this file has a project of
// its own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  execute(`grant execute on function ${PASSPORT_LIMITS} to authenticated`);
  execute(`grant execute on function ${SIGNUP_DOCUMENTS} to anon, authenticated`);
  execute(`grant select on ${MEMBERS_TABLE} to authenticated`);
});

test.describe("a page that fails to load (REL-01)", () => {
  test("a page of the signed-in area without a boundary of its own shows the shared error in the shell, with Try again and a link home, and Try again reads it again", async ({ browser }) => {
    const worker = await createCommittedUser("worker");
    const { context, page } = await signedInPage(browser, worker);
    execute(`revoke execute on function ${PASSPORT_LIMITS} from authenticated`);

    await page.goto("/en/passport");
    await expect(page.getByRole("heading", { name: "This page could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByText("Nothing was changed. Try again in a moment.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/en");
    await expect(mainNavigation(page).getByRole("link", { name: "Passport" })).toHaveAttribute("aria-current", "page");
    await expect(accountButton(page)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Legal" })).toBeVisible();
    await expect(page.getByText(/permission denied|passport_limits/)).toHaveCount(0);
    await expectNoAxeViolations(page);

    execute(`grant execute on function ${PASSPORT_LIMITS} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your passport" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await context.close();
  });

  test("a page of the sign-in area shows the same error with Try again and a link home", async ({ page }) => {
    execute(`revoke execute on function ${SIGNUP_DOCUMENTS} from anon, authenticated`);

    await page.goto("/en/signup");
    await expect(page.getByRole("heading", { name: "This page could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/en");
    await expectNoAxeViolations(page);

    execute(`grant execute on function ${SIGNUP_DOCUMENTS} to anon, authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  test("an employer whose organisations cannot be read keeps the header with the account menu and the footer, and the links come back with the read", async ({ browser }) => {
    const team = await newTeam();
    const { context, page } = await signedInPage(browser, team.owner);
    execute(`revoke select on ${MEMBERS_TABLE} from authenticated`);

    await page.goto("/en/settings/notifications");
    await expect(accountButton(page)).toBeVisible();
    await expect(mainNavigation(page)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Legal" })).toBeVisible();
    await expect(page.getByText(/permission denied|organization_members/)).toHaveCount(0);
    await expectNoAxeViolations(page);

    execute(`grant select on ${MEMBERS_TABLE} to authenticated`);
    await page.reload();
    await expect(mainNavigation(page).getByRole("link", { name: "Team" })).toBeVisible();
    await context.close();
  });
});
