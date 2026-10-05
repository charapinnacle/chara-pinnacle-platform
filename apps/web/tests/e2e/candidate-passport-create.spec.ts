import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { choose } from "./support/combobox";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { passportAudit, profileRows, signIn } from "./support/passport";
import { execute, literal } from "./support/db";
import { captureActionRequests } from "./support/server-action";

function country(page: Page) {
  return page.getByRole("combobox", { name: "Current country", exact: true });
}

test.describe("candidate passport: onboarding", () => {
  test("FR-B1 AC1: a new candidate creates the passport once, lands on the dashboard at 10 percent and cannot onboard again", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker", { passport: false });
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Your account type is Worker" })).toBeVisible();
    await expectNoAxeViolations(page);

    const calls = captureActionRequests(page);
    await page.getByLabel("First name", { exact: true }).fill("Amina");
    await page.getByLabel("Last name", { exact: true }).fill("Okafor");
    await choose(page, "Current country", "Nigeria");
    await page.getByRole("button", { name: "Create my passport" }).dblclick();

    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    await expect(page.getByText("10% complete")).toBeVisible();
    await expect(page.getByText("Next:")).toContainText("Occupation");
    expect(calls).toHaveLength(1);

    expect(profileRows(user.id)).toEqual([
      expect.objectContaining({ first_name: "Amina", last_name: "Okafor", current_country: "NG", searchable: false }),
    ]);
    const [audit, ...rest] = passportAudit(user.id);
    expect(rest).toEqual([]);
    expect(audit).toEqual({ actor_id: user.id, entity_type: "worker_profiles", entity_id: user.id, metadata: {} });

    await page.goto("/en/passport");
    await expect(page.getByLabel("First name", { exact: true })).toHaveValue("Amina");
    await expect(page.getByLabel("Last name", { exact: true })).toHaveValue("Okafor");
    await expect(country(page)).toHaveValue("Nigeria");

    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
  });

  test("FR-B1 AC1: the form asks for the missing values and keeps what was typed", async ({ page }) => {
    const user = await createCommittedUser("worker", { passport: false });
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await page.getByLabel("Last name", { exact: true }).fill("Okafor1");
    await page.getByRole("button", { name: "Create my passport" }).click();

    await expect(page.getByLabel("First name", { exact: true })).toBeFocused();
    await expect(page.getByText("Enter your first name.")).toBeVisible();
    await expect(page.getByText("Last name can only contain letters")).toBeVisible();
    await expect(page.getByText("Choose a country.")).toBeVisible();
    await expect(page.getByLabel("Last name", { exact: true })).toHaveValue("Okafor1");
    expect(profileRows(user.id)).toEqual([]);
  });

  test("FR-B1: a candidate without a passport is sent to onboarding and an employer cannot open the passport", async ({
    page,
    browser,
  }) => {
    const candidate = await createCommittedUser("worker", { passport: false });
    await logIn(page, candidate, "/en/passport");
    await expect(page).toHaveURL(/\/en\/onboarding$/);

    const employer = await createCommittedUser("company");
    const context = await browser.newContext();
    const employerPage = await context.newPage();
    await logIn(employerPage, employer);
    await expect(employerPage).toHaveURL(/\/en\/dashboard\/employer$/);
    await employerPage.goto("/en/passport");
    await expect(employerPage).toHaveURL(/\/en\/dashboard\/employer$/);
    await context.close();

    const visitor = await browser.newContext();
    const visitorPage = await visitor.newPage();
    await visitorPage.goto("/en/passport");
    await expect(visitorPage).toHaveURL(`/en/login?next=${encodeURIComponent("/en/passport")}`);
    await visitor.close();
  });
});


test.describe("candidate passport: isolation", () => {
  test("FR-B1 AC10: a candidate sees only the own passport", async ({ browser }) => {
    const first = await createCommittedUser("worker");
    const second = await createCommittedUser("worker");
    execute(
      `update public.worker_profiles set first_name = 'Firstly', headline = 'Only for the first' where user_id = ${literal(first.id)};
       update public.worker_profiles set first_name = 'Secondly' where user_id = ${literal(second.id)}`,
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, second);
    await page.goto("/en/passport");
    await expect(page.getByLabel("First name", { exact: true })).toHaveValue("Secondly");
    await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("");
    await expect(page.locator("body")).not.toContainText("Firstly");
    await context.close();
  });
});
