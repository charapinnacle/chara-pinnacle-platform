import type { Page } from "@playwright/test";
import { seedAudit, seedOrganizations, seedUsers, signInStaff, uniqueTag } from "./support/admin";
import { newApplicant, seedApplication } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { newCompany, seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { expect, test } from "./support/test";

function rows(page: Page, table: string) {
  return page.getByRole("table", { name: table }).getByRole("row").filter({ has: page.getByRole("cell") });
}

async function search(page: Page, label: string, term: string): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await waitForHydration(input);
  await input.fill(term);
  await input.press("Enter");
}

async function names(page: Page, table: string): Promise<string[]> {
  return rows(page, table).evaluateAll((elements) => elements.map((row) => row.querySelector("td")?.textContent ?? ""));
}

function value(page: Page, label: string) {
  return page.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]");
}

async function delaySearch(page: Page, path: string, ms: number): Promise<void> {
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test.describe("the search of users, organisations and the audit log", () => {
  test("FR-F1 AC4: a short term is refused in the form, a long one shows a skeleton and then 25 users a page, and the pages follow one another", async ({
    page,
  }) => {
    const tag = uniqueTag();
    seedUsers(tag, 60);
    await signInStaff(page, "admin", "/en/admin/users");
    await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/en/admin/users")) posts.push(request.url());
    });
    await search(page, "Search users", "ab");
    await expect(page.getByText("Enter at least 3 characters")).toBeVisible();
    await expect(page.getByLabel("Search users", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(posts).toEqual([]);
    await page.getByLabel("Search users", { exact: true }).fill("x".repeat(150));
    expect((await page.getByLabel("Search users", { exact: true }).inputValue()).length).toBe(100);

    await delaySearch(page, "/en/admin/users", 1500);
    await search(page, "Search users", `test user ${tag}`);
    await expect(page.locator('div[aria-busy="true"]').first()).toBeVisible();
    await expect(page.getByRole("status").getByText("Loading")).toBeVisible();
    await expect(rows(page, "Users")).toHaveCount(25);
    await expect(page.locator('div[aria-busy="true"]')).toHaveCount(0);
    expect(await names(page, "Users")).toEqual(Array.from({ length: 25 }, (_, n) => `Test User ${tag} ${String(n + 1).padStart(2, "0")}`));
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Page 2")).toBeVisible();
    expect((await names(page, "Users"))[0]).toBe(`Test User ${tag} 26`);
    expect(await names(page, "Users")).toHaveLength(25);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Page 3")).toBeVisible();
    expect(await names(page, "Users")).toEqual(Array.from({ length: 10 }, (_, n) => `Test User ${tag} ${n + 51}`));
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByText("Page 2")).toBeVisible();
    expect((await names(page, "Users"))[0]).toBe(`Test User ${tag} 26`);
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect((await names(page, "Users"))[0]).toBe(`Test User ${tag} 01`);
  });

  test("FR-F1 AC4: a term with no match shows the empty state, and a failed request shows a toast and Try again and none of the earlier rows", async ({
    page,
    context,
  }) => {
    const tag = uniqueTag();
    seedUsers(tag, 3);
    await signInStaff(page, "admin", "/en/admin/users");
    await search(page, "Search users", `test user ${tag}`);
    await expect(rows(page, "Users")).toHaveCount(3);

    await search(page, "Search users", "zzzzqq");
    await expect(page.getByRole("heading", { name: "No users found", level: 2 })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);

    await search(page, "Search users", `test user ${tag}`);
    await expect(rows(page, "Users")).toHaveCount(3);
    await context.setOffline(true);
    await search(page, "Search users", `seed-${tag}`);
    await expect(page.getByRole("heading", { name: "The users could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.").first()).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText(`Test User ${tag}`)).toHaveCount(0);

    await context.setOffline(false);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "The users could not be loaded" })).toHaveCount(0);
  });

  test("FR-F1 AC4: users match on the email address and the user id, and the keyboard reaches the first row, which opens the detail", async ({
    page,
  }) => {
    const tag = uniqueTag();
    seedUsers(tag, 2);
    await signInStaff(page, "trust_safety", "/en/admin/users");
    await search(page, "Search users", `seed-${tag}-2@search.test`.toUpperCase());
    await expect(rows(page, "Users")).toHaveCount(1);
    await expect(rows(page, "Users").first()).toContainText(`seed-${tag}-2@search.test`);
    const user = page.getByRole("table", { name: "Users" }).getByRole("link").first();
    const href = await user.getAttribute("href");
    expect(href).toMatch(/^\/en\/admin\/users\/[0-9a-f-]{36}$/);

    await search(page, "Search users", href?.split("/").pop() ?? "");
    await expect(rows(page, "Users")).toHaveCount(1);

    await page.getByLabel("Search users", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Search" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(user).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(href ?? "");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`Test User ${tag} 02`);
  });

  test("FR-F1 AC4: organisations are searched by display name, legal name and address name and paged 25 at a time", async ({ page }) => {
    const tag = uniqueTag();
    seedOrganizations(tag, 30, (await createCommittedUser("company")).id);
    await signInStaff(page, "trust_safety", "/en/admin/organizations");
    await expectNoAxeViolations(page);
    await search(page, "Search organisations", `test org ${tag}`);
    await expect(rows(page, "Organisations")).toHaveCount(25);
    expect((await names(page, "Organisations"))[0]).toContain(`Test Org ${tag} 01`);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(rows(page, "Organisations")).toHaveCount(5);
    expect((await names(page, "Organisations"))[0]).toContain(`Test Org ${tag} 26`);
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

    await search(page, "Search organisations", `legal name 7 gmbh`);
    await expect(rows(page, "Organisations").filter({ hasText: `Test Org ${tag} 07` })).toHaveCount(1);
    await search(page, "Search organisations", `TEST-ORG-${tag}-12`);
    await expect(rows(page, "Organisations")).toHaveCount(1);
    await expect(rows(page, "Organisations").first()).toContainText(`Test Org ${tag} 12`);
    await search(page, "Search organisations", "zzzzqq");
    await expect(page.getByRole("heading", { name: "No organisations found", level: 2 })).toBeVisible();
  });

  test("FR-F1 AC4: the audit log is filtered, newest first, 25 rows a page, with the filter errors named", async ({ page }) => {
    const tag = uniqueTag();
    seedAudit(tag, 60);
    await signInStaff(page, "admin", "/en/admin/audit");
    await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    const action = page.getByLabel("Action", { exact: true });
    await waitForHydration(action);

    await page.getByLabel("Actor (user id)").fill("not-a-user");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("Enter a valid user id").first()).toBeVisible();
    await expect(page.getByLabel("Actor (user id)")).toHaveAttribute("aria-describedby", /error/);
    await page.getByLabel("Actor (user id)").fill("");

    await page.getByLabel("From (UTC)").fill("2026-12-31");
    await page.getByLabel("To (UTC)").fill("2026-01-01");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("The start date must not be after the end date").first()).toBeVisible();
    await page.getByLabel("From (UTC)").fill("");
    await page.getByLabel("To (UTC)").fill("");

    await action.fill(`e2e.${tag}`);
    await action.press("Enter");
    await expect(rows(page, "Audit log, newest first")).toHaveCount(25);
    const entities = () =>
      rows(page, "Audit log, newest first").evaluateAll((elements) => elements.map((row) => row.querySelectorAll("td")[3]?.textContent ?? ""));
    expect((await entities())[0]).toBe("e2e: entity-1");
    expect((await entities())[24]).toBe("e2e: entity-25");
    await expect(rows(page, "Audit log, newest first").first()).toContainText("Reason number 1");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Page 2")).toBeVisible();
    expect((await entities())[0]).toBe("e2e: entity-26");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(rows(page, "Audit log, newest first")).toHaveCount(10);
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

    await page.getByLabel("Entity id").fill("entity-7");
    await page.getByLabel("Entity id").press("Enter");
    await expect(rows(page, "Audit log, newest first")).toHaveCount(1);
    await action.fill(`e2e.nothing-${tag}`);
    await action.press("Enter");
    await expect(page.getByRole("heading", { name: "No audit entries match", level: 2 })).toBeVisible();
  });

  test("FR-F1 AC3: the user page shows the counts and the memberships, and the organisation page the members and the vacancies, to both roles and with no applicant data", async ({
    page,
    browser,
  }) => {
    const company = await newCompany();
    const jobs = [1, 2, 3, 4].map((n) => seedJob(company, { title: `Detail vacancy ${n}`, status: "open" }));
    const candidate = await newApplicant();
    for (const job of jobs.slice(0, 3)) seedApplication(candidate.id, job, company.id, { coverNote: "PRIVATE-COVER-NOTE" });
    const [{ display_name: organizationName }] = query<{ display_name: string }>(
      `select display_name from public.organizations where id = '${company.id}'`,
    );

    await signInStaff(page, "admin", `/en/admin/users/${candidate.id}`);
    await expect(value(page, "Applications submitted")).toHaveText("3");
    await expect(value(page, "Vacancies created")).toHaveText("0");
    await expect(value(page, "Email")).toHaveText(candidate.email);
    await expect(page.getByText("This user belongs to no organisation.")).toBeVisible();
    await expect(page.getByText("PRIVATE-COVER-NOTE")).toHaveCount(0);

    await page.goto(`/en/admin/users/${company.owner.id}`);
    await expect(value(page, "Vacancies created")).toHaveText("4");
    await expect(value(page, "Applications submitted")).toHaveText("0");
    const membership = page.locator("#organisations li");
    await expect(membership).toHaveCount(1);
    await expect(membership.getByRole("link", { name: organizationName })).toHaveAttribute("href", `/en/admin/organizations/${company.id}`);
    await expect(membership).toContainText("Owner");

    const second = await browser.newContext();
    const reviewer = await second.newPage();
    await signInStaff(reviewer, "trust_safety", `/en/admin/users/${company.owner.id}`);
    await expect(value(reviewer, "Vacancies created")).toHaveText("4");
    for (const tab of [page, reviewer]) {
      await tab.goto(`/en/admin/organizations/${company.id}`);
      await expect(tab.getByRole("heading", { name: organizationName, level: 1 })).toBeVisible();
      const members = tab.getByRole("table", { name: "Members" }).getByRole("row").filter({ has: tab.getByRole("cell") });
      await expect(members).toHaveCount(1);
      await expect(members.first()).toContainText(company.owner.id);
      await expect(members.first()).toContainText("Owner");
      await expect(tab.getByRole("table", { name: "Vacancies" }).getByRole("row").filter({ has: tab.getByRole("cell") })).toHaveCount(4);
      await expect(tab.getByRole("table", { name: "Vacancies" })).toContainText("Detail vacancy 3");
      await expect(tab.getByText(/Applications submitted|PRIVATE-COVER-NOTE/)).toHaveCount(0);
      await expect(tab.getByText(candidate.email)).toHaveCount(0);
    }
    await second.close();
  });
});
