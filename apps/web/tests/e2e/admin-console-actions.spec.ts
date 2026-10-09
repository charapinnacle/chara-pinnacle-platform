import type { Page } from "@playwright/test";
import { signInStaff } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { newOwner } from "./support/mfa";
import { expect, test } from "./support/test";
import { publicUrl } from "./support/vacancy-page";

const REASON = "Repeated fake profile reports";
const BACK = "Identity confirmed after complaint";

function moderationRows(targetId: string) {
  return query<{ action: string; statement_of_reasons: string }>(
    `select action, statement_of_reasons from public.moderation_actions where target_id = ${literal(targetId)} order by id`,
  );
}

function auditRows(entityId: string, action: string) {
  return query<{ actor_id: string; metadata: { reason: string; request_id: string } }>(
    `select actor_id, metadata from audit.log where entity_id = ${literal(entityId)} and action = ${literal(action)} order by id`,
  );
}

function queued(key: "user_id" | "organization_id", id: string) {
  return query<{ message: { action: string } }>(
    `select message from pgmq.q_account_ops where message ->> ${literal(key)} = ${literal(id)} order by msg_id`,
  ).map((row) => row.message.action);
}

async function submit(page: Page, button: string, reason: string): Promise<void> {
  const field = page.getByLabel("Statement of reasons");
  await waitForHydration(field);
  await field.fill(reason);
  await page.getByRole("button", { name: button, exact: true }).click();
}

test.describe("suspending and reinstating from the console", () => {
  test("FR-F1 AC8: two submissions at the same moment suspend once, the other is told so", async ({
    page,
    browser,
  }) => {
    const user = await createCommittedUser("worker");
    const victim = await browser.newContext();
    const victimPage = await victim.newPage();
    await logIn(victimPage, user);
    await expect(victimPage).toHaveURL(/\/en\/dashboard\/worker$/);

    await signInStaff(page, "trust_safety", `/en/admin/users/${user.id}`);
    const second = await page.context().newPage();
    await second.goto(`/en/admin/users/${user.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const tab of [page, second]) {
      await waitForHydration(tab.getByLabel("Statement of reasons"));
      await tab.getByLabel("Statement of reasons").fill(REASON);
    }
    await Promise.all([
      page.getByRole("button", { name: "Suspend user", exact: true }).click(),
      second.getByRole("button", { name: "Suspend user", exact: true }).click(),
    ]);
    await expect.poll(() => moderationRows(user.id).length).toBe(1);
    const results = await Promise.all(
      [page, second].map((tab) =>
        Promise.race([
          tab.getByText("The account is suspended", { exact: true }).waitFor().then(() => "done"),
          tab.getByText("This account is already suspended", { exact: true }).waitFor().then(() => "already"),
        ]),
      ),
    );
    expect(results.sort()).toEqual(["already", "done"]);
    expect(moderationRows(user.id)).toEqual([{ action: "account_suspended", statement_of_reasons: REASON }]);
    expect(auditRows(user.id, "user.suspend")).toHaveLength(1);
    expect(queued("user_id", user.id)).toEqual(["suspend_user"]);
    expect(query<{ n: number }>(`select count(*)::int as n from public.notifications where user_id = ${literal(user.id)} and kind = 'account_suspended'`)[0].n).toBe(1);

    await victimPage.goto("/en/passport");
    await expect(victimPage).toHaveURL(/\/en\/suspended$/);
    await expect(victimPage.getByRole("heading", { name: "Your account is suspended" })).toBeVisible();
    await victim.close();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Reinstate this account" })).toBeVisible();
    await expectNoAxeViolations(page);
    await submit(page, "Reinstate user", BACK);
    await expect(page.getByText("The account is reinstated", { exact: true })).toBeVisible();
    expect(moderationRows(user.id).map((row) => row.action)).toEqual(["account_suspended", "account_reinstated"]);
    expect(queued("user_id", user.id)).toEqual(["suspend_user", "reinstate_user"]);
    await expect(page.getByRole("heading", { name: "Suspend this account" })).toBeVisible();
  });

  test("FR-F1 AC8: a double click on the button sends one request, and a short reason is refused in the form", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await signInStaff(page, "trust_safety", `/en/admin/users/${user.id}`);
    const field = page.getByLabel("Statement of reasons");
    await waitForHydration(field);
    await field.fill("too short");
    await page.getByRole("button", { name: "Suspend user", exact: true }).click();
    await expect(page.getByText("Give a reason of at least 10 characters").first()).toBeVisible();
    expect(moderationRows(user.id)).toEqual([]);

    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/admin/users/")) posts.push(request.url());
    });
    await field.fill(REASON);
    await page.getByRole("button", { name: "Suspend user", exact: true }).dblclick();
    await expect(page.getByText("The account is suspended", { exact: true })).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(moderationRows(user.id)).toHaveLength(1);
  });

  test("FR-F1 AC6 and AC9: an organisation is suspended from its page, its vacancy leaves the public, the members see the notice, and reinstating brings it back", async ({
    page,
    browser,
  }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const vacancy = seedJob(company, { title: "Suspension welder", status: "open" });
    const hidden = seedJob(company, { title: "Hidden welder", status: "open" });
    execute(`update public.jobs set moderation_state = 'hidden' where id = ${literal(hidden)}`);
    expect((await page.request.get(publicUrl(vacancy))).status()).toBe(200);

    await signInStaff(page, "trust_safety", `/en/admin/organizations/${company.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vacancy Bau");
    await expect(page.getByRole("row", { name: /Hidden welder/ }).getByRole("cell").last()).toHaveText("Hidden");
    await expectNoAxeViolations(page);
    await submit(page, "Suspend organisation", REASON);
    await expect(page.getByText("The organisation is suspended", { exact: true })).toBeVisible();

    expect((await page.request.get(publicUrl(vacancy))).status()).toBe(404);
    expect(
      query<{ title: string; moderation_state: string }>(`select title, moderation_state::text from public.jobs where organization_id = ${literal(company.id)} order by title`),
    ).toEqual([
      { title: "Hidden welder", moderation_state: "hidden" },
      { title: "Suspension welder", moderation_state: "org_suspended" },
    ]);
    expect(moderationRows(company.id)).toEqual([{ action: "organization_suspended", statement_of_reasons: REASON }]);
    expect(auditRows(company.id, "organization.suspend")).toHaveLength(1);
    expect(queued("organization_id", company.id)).toEqual(["sign_out_organization"]);
    const notified = query<{ user_id: string }>(`select user_id from public.notifications where kind = 'account_suspended' and payload ->> 'org_slug' = ${literal(company.slug)}`);
    expect(notified.map((row) => row.user_id)).toEqual([company.owner.id]);

    const people = await browser.newContext();
    const memberPage = await people.newPage();
    await logIn(memberPage, member);
    await expect(memberPage).toHaveURL(/\/en\/dashboard\/employer$/);
    await memberPage.goto(`/en/org/${company.slug}`);
    await expect(memberPage.getByRole("heading", { name: "This organisation is suspended" })).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Applicants" })).toHaveCount(0);
    await expect(memberPage.getByRole("link", { name: "Vacancies" })).toHaveCount(0);
    await people.close();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Reinstate this organisation" })).toBeVisible();
    await submit(page, "Reinstate organisation", BACK);
    await expect(page.getByText("The organisation is reinstated", { exact: true })).toBeVisible();
    expect((await page.request.get(publicUrl(vacancy))).status()).toBe(200);
    expect((await page.request.get(publicUrl(hidden))).status()).toBe(404);
    expect(moderationRows(company.id).map((row) => row.action)).toEqual(["organization_suspended", "organization_reinstated"]);

    await page.goto("/en/admin/suspensions");
    await expect(page.getByRole("table", { name: "Suspensions and reinstatements, newest first" })).toContainText(BACK);
    await expect(page.getByRole("table", { name: "Suspensions and reinstatements, newest first" })).toContainText("Organisation suspended");
    await expectNoAxeViolations(page);
  });

  test("FR-F1 AC2: a Platform Administrator sees an account without a form to suspend it, and an unknown or malformed id is not found", async ({ page }) => {
    const owner = await newOwner();
    await signInStaff(page, "admin", `/en/admin/users/${owner.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByLabel("Statement of reasons")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Reset two-step verification of this user" })).toBeVisible();
    await page.goto(`/en/admin/users/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.goto("/en/admin/users/not-an-id");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});
