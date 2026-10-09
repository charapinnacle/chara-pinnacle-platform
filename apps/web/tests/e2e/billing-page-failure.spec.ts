import { billingPath, summaryValue } from "./support/billing";
import { DAY, fromNow, seedSubscription } from "./support/dashboard";
import { execute, executeAsync } from "./support/db";
import { uniqueName } from "./support/organizations";
import { newTeam, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

const FUNCTION = "public.billing_usage(uuid)";

// The vacancies table is locked for the whole database in the first test and the usage function is withdrawn from the API
// role in the second, so this file has a project of its own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  execute(`grant execute on function ${FUNCTION} to authenticated`);
});

async function ownerAtAal2(page: import("@playwright/test").Page) {
  const team = await newTeam(uniqueName("Failing Bau"));
  seedSubscription(team, "employer_starter", "active", { currentPeriodEnd: fromNow(20 * DAY) });
  await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
  await expect(summaryValue(page, "Plan")).toHaveText("Basic");
  return team;
}

test.describe("the billing page when the database is slow or fails (FR-G5 AC11)", () => {
  test("a skeleton marked busy shows while the data is delayed and the page replaces it", async ({ page }) => {
    const team = await ownerAtAal2(page);
    const held = executeAsync("begin; lock table public.jobs in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await page.goto(billingPath(team.slug), { waitUntil: "commit" });
    const skeleton = page.getByRole("status").filter({ hasText: "Loading" });
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(summaryValue(page, "Plan")).toHaveText("Basic");
    await expect(skeleton).toHaveCount(0);
    await held;
  });

  test("a failed request shows a message, an error toast and Try again, and no stale data", async ({ page }) => {
    const team = await ownerAtAal2(page);
    execute(`revoke execute on function ${FUNCTION} from authenticated`);

    await page.goto(billingPath(team.slug));
    await expect(page.getByRole("heading", { name: "Billing details could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toHaveCount(0);
    await expect(page.getByText("Basic")).toHaveCount(0);
    await expect(page.getByText(/permission denied|billing_usage/)).toHaveCount(0);

    execute(`grant execute on function ${FUNCTION} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(summaryValue(page, "Plan")).toHaveText("Basic");
  });
});
