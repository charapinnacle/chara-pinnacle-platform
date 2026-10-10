import type { Page } from "@playwright/test";
import { enrolledStaff } from "./support/admin";
import { PHONE, signedInPage } from "./support/app-shell";
import { seedApplication, seedEvent } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { card, dashboardUrl, DAY, HOUR, seedSubscription } from "./support/dashboard";
import { execute, literal, query } from "./support/db";
import { seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import { enterCode } from "./support/mfa";
import { uniqueName } from "./support/organizations";
import { seedSaved } from "./support/saved";
import { newTeam, seedInvitation, signInAtAal2, type Team } from "./support/team";
import { expect, test } from "./support/test";

const STAGES = ["Applied", "Viewed", "Shortlisted", "Interview", "Offer", "Hired", "Not selected", "Withdrawn"];

const count = (sql: string) => query<{ n: number }>(`select (${sql})::int as n`)[0].n;

async function stageTable(page: Page, name: string): Promise<string[][]> {
  const table = page.getByRole("table", { name });
  await expect(table).toBeVisible();
  return table.locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) => Array.from(row.querySelectorAll("th, td")).map((cell) => (cell.textContent ?? "").trim())),
  );
}

// The console counts the whole platform, which other tests change while this one runs: read the database and the page
// again until both agree.
async function expectFigure(page: Page, label: string, sql: string, href: string | RegExp): Promise<number> {
  let value = 0;
  await expect(async () => {
    value = count(sql);
    await page.reload();
    await expect(card(page, `${label}: ${value}`)).toHaveAttribute("href", href, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return value;
}

async function ownerAtAal2(page: Page, team: Team): Promise<void> {
  await page.context().clearCookies();
  await logIn(page, team.owner, dashboardUrl(team.slug));
  await page.getByRole("link", { name: "Enter your code" }).click();
  await enterCode(page, team.ownerSecret);
  await expect(page).toHaveURL(dashboardUrl(team.slug));
}

test.describe("the candidate dashboard (UX-03, FR-B4, FR-D3)", () => {
  test("shows the counts of the database, the three latest applications with their stage, and links to each list", async ({ browser }) => {
    const team = await newTeam(uniqueName("Dash Bau"));
    const jobs = ["Dash electrician", "Dash welder", "Dash fitter", "Dash roofer"].map((title) => seedJob(team, { title, status: "open" }));
    const worker = await createCommittedUser("worker");
    const stages = ["applied", "viewed", "interview", "withdrawn"];
    jobs.forEach((job, index) => {
      const id = seedApplication(worker.id, job, team.id, { status: stages[index], createdAt: `now() - interval '${10 - index} days'` });
      if (stages[index] !== "applied") seedEvent(id, { from: "applied", to: stages[index], at: new Date(Date.now() - (4 - index) * HOUR).toISOString() });
    });
    seedSaved(worker.id, jobs[0]);
    seedSaved(worker.id, jobs[1]);
    seedSaved(worker.id, jobs[2]);
    const { context, page } = await signedInPage(browser, worker);

    await page.goto("/en/dashboard/worker");
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    const total = count(`select count(*) from public.job_applications where worker_user_id = ${literal(worker.id)}`);
    const interviews = count(`select count(*) from public.job_applications where worker_user_id = ${literal(worker.id)} and status = 'interview'`);
    const saved = count(`select count(*) from public.saved_jobs where worker_user_id = ${literal(worker.id)}`);
    expect([total, interviews, saved]).toEqual([4, 1, 3]);
    await expect(card(page, `My applications: ${total}`)).toHaveAttribute("href", "/en/applications");
    await expect(card(page, `My applications: ${total}`)).toContainText("3 in progress");
    await expect(card(page, `Interviews: ${interviews}`)).toHaveAttribute("href", "/en/applications?stage=interview");
    await expect(card(page, `Saved vacancies: ${saved}`)).toHaveAttribute("href", "/en/saved");

    const byStage = query<{ status: string; n: number }>(
      `select s.status::text as status, count(a.id)::int as n from unnest(enum_range(null::public.application_status)) s(status)
       left join public.job_applications a on a.status = s.status and a.worker_user_id = ${literal(worker.id)} group by s.status order by s.status`,
    );
    expect(await stageTable(page, "Applications by stage")).toEqual(STAGES.map((label, index) => [label, String(byStage[index].n)]));
    await expect(page.getByRole("table", { name: "Applications by stage" }).locator("tfoot")).toHaveText(`Total${total}`);

    const recent = page.getByRole("region", { name: "Recent applications" }).getByRole("listitem");
    await expect(recent).toHaveCount(3);
    await expect(recent.nth(0)).toContainText("Dash roofer");
    await expect(recent.nth(0)).toContainText("Withdrawn");
    await expect(recent.nth(0)).toContainText("Updated 1 hour ago");
    await expect(recent.nth(1)).toContainText("Dash fitter");
    await expect(recent.nth(1)).toContainText("Interview");
    await expect(recent.nth(2)).toContainText("Dash welder");
    await expect(page.getByRole("region", { name: "Recent applications" })).not.toContainText("Dash electrician");
    await expectNoAxeViolations(page);

    await recent.nth(1).getByRole("link").click();
    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Dash fitter", level: 1 })).toBeVisible();

    await page.goto("/en/dashboard/worker");
    await page.getByRole("table", { name: "Applications by stage" }).getByRole("link", { name: "Withdrawn", exact: true }).click();
    await expect(page).toHaveURL("/en/applications?stage=withdrawn");
    await expect(page.getByRole("main").locator("ul > li")).toHaveCount(1);
    await context.close();
  });

  test("a new account sees an empty state that names the first step, at 1280 and 375 px without overflow", async ({ browser }) => {
    const fresh = await createCommittedUser("worker");
    const { context, page } = await signedInPage(browser, fresh);
    await page.goto("/en/dashboard/worker");
    await expect(page.getByRole("heading", { name: "No applications yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Complete your passport" })).toHaveAttribute("href", "/en/passport#occupation");
    await expect(card(page, "My applications: 0")).toBeVisible();
    await expect(card(page, "Saved vacancies: 0")).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent applications" })).toHaveCount(0);
    await expectNoAxeViolations(page);

    execute(`update public.worker_profiles set occupation_id = '7212' where user_id = ${literal(fresh.id)}`);
    await page.reload();
    await expect(page.getByRole("link", { name: "Browse vacancies" })).toHaveAttribute("href", "/en/jobs");
    await context.close();

    const phone = await signedInPage(browser, fresh, PHONE);
    await phone.page.goto("/en/dashboard/worker");
    await expect(card(phone.page, "My applications: 0")).toBeVisible();
    expect(await overflow(phone.page)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(phone.page);
    await phone.context.close();
  });
});

test.describe("the employer first steps (UX-04, FR-E5)", () => {
  test("each step is ticked from the database, an open step is the link that does it, and the list leaves once all are done", async ({ page }) => {
    const team = await newTeam(uniqueName("Steps Dash"));
    await ownerAtAal2(page, team);
    const steps = page.getByRole("region", { name: "Get set up" });
    await expect(steps.getByRole("listitem")).toHaveText([
      "Create your organisation (done)",
      "Set up two-step verification (done)",
      "Publish your first vacancy",
      "Invite a team member",
      "Choose a plan",
    ]);
    await expect(steps).toContainText("2 of 5 done");
    await expect(steps.getByRole("link", { name: "Publish your first vacancy" })).toHaveAttribute("href", `/en/org/${team.slug}/jobs/new`);
    await expect(steps.getByRole("link", { name: "Invite a team member" })).toHaveAttribute("href", `/en/org/${team.slug}/members`);
    await expect(steps.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", `/en/org/${team.slug}/billing`);
    await expect(page.getByRole("link", { name: "New vacancy" })).toHaveAttribute("href", `/en/org/${team.slug}/jobs/new`);
    await expectNoAxeViolations(page);

    seedJob(team, { title: "Steps draft" });
    await page.reload();
    await expect(steps.getByRole("link", { name: "Publish your first vacancy" })).toBeVisible();

    seedJob(team, { title: "Steps open", status: "open" });
    seedInvitation(team, `steps-${Date.now()}@example.test`);
    await page.reload();
    await expect(steps).toContainText("4 of 5 done");
    await expect(steps.getByRole("listitem").nth(2)).toHaveText("Publish your first vacancy (done)");
    await expect(steps.getByRole("listitem").nth(3)).toHaveText("Invite a team member (done)");

    seedSubscription(team, "employer_starter", "trialing", { trialEndsAt: new Date(Date.now() + 10 * DAY).toISOString() });
    await page.reload();
    await expect(card(page, /^Open vacancies/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Get set up" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Quick actions" }).getByRole("link", { name: "Manage your team" })).toBeVisible();
  });

  test("a plain member sees no checklist and no billing action", async ({ browser }) => {
    const team = await newTeam(uniqueName("Member Dash"));
    const member = await createCommittedUser("company");
    execute(
      `insert into public.organization_members (organization_id, user_id, role, accepted_at, invited_by)
       values (${literal(team.id)}, ${literal(member.id)}, 'member', now(), ${literal(team.owner.id)})`,
    );
    const { context, page } = await signedInPage(browser, member);
    await page.goto(dashboardUrl(team.slug));
    await expect(card(page, /^Open vacancies/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Get set up" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New vacancy" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Quick actions" }).getByRole("link")).toHaveText(["Review applicants", "Notification settings"]);
    await context.close();
  });
});

test.describe("the console landing (UX-10, FR-F1)", () => {
  test.describe.configure({ timeout: 90_000 });

  test("the Platform Administrator sees the staff, the applications of the last 30 days and the drafts, each from the database and linked", async ({ page }) => {
    const staff = await enrolledStaff("admin");
    await signInAtAal2(page, staff.user, staff.secret, "/en/admin");
    await expectFigure(page, "Active staff roles", "select count(*) from public.platform_staff where revoked_at is null", "/en/admin/staff");
    await expectFigure(
      page,
      "Applications in the last 30 days",
      "select count(*) from public.job_applications where created_at >= (current_date - 29)::timestamp at time zone 'UTC' and created_at < (current_date + 1)::timestamp at time zone 'UTC'",
      /\/en\/admin\/statistics\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/,
    );
    const drafts = await expectFigure(page, "Legal documents in draft", "select count(*) from public.v_legal_current where is_draft", "/en/admin/legal");
    await expect(page.getByRole("table", { name: "Applications by stage" }).locator("tfoot")).toHaveText(/^Total\d+$/);
    await expect(
      page.getByRole("region", { name: "Legal documents" }).getByRole("listitem").filter({ has: page.getByText("Draft", { exact: true }) }),
    ).toHaveCount(drafts);
    await expect(page.getByRole("region", { name: "Trust and safety" })).toHaveCount(0);
    await expectNoAxeViolations(page);

    await card(page, /^Active staff roles/).click();
    await expect(page).toHaveURL("/en/admin/staff");
  });

  test("the Trust & Safety Administrator sees what is suspended or hidden now, from the database, and nothing of the administrator", async ({ page }) => {
    const staff = await enrolledStaff("trust_safety");
    await signInAtAal2(page, staff.user, staff.secret, "/en/admin");
    await expectFigure(page, "Suspended accounts", "select count(*) from public.profiles where status = 'suspended'", "/en/admin/suspensions");
    await expectFigure(page, "Suspended organisations", "select count(*) from public.organizations where status = 'suspended'", "/en/admin/suspensions");
    await expectFigure(page, "Hidden vacancies", "select count(*) from public.jobs where moderation_state = 'hidden'", "/en/admin/moderation");
    await expect(page.getByRole("region", { name: "Platform overview" })).toHaveCount(0);
    await expect(card(page, /^Active staff roles/)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("a Verification Reviewer is told that no function is available, with no figure", async ({ page }) => {
    const staff = await enrolledStaff("verification_reviewer");
    await signInAtAal2(page, staff.user, staff.secret, "/en/admin");
    await expect(page.getByText("No functions are available for your role in this release.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link")).toHaveCount(0);
  });
});
