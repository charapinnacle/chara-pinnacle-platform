import { breadcrumbs, signedInPage } from "./support/app-shell";
import { expectNoAxeViolations } from "./support/axe";
import { seedApplicationAgo, HOUR } from "./support/dashboard";
import { seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { checkoutPath } from "./support/billing";
import { newTeam, newVisitor, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";
import { uniqueName } from "./support/organizations";

test.describe("breadcrumbs on the nested pages (UX-01)", () => {
  test("the organisation pages show where they are, the last item is the page itself, and every earlier item leads back", async ({ browser }) => {
    const name = uniqueName("Crumb Bau");
    const team = await newTeam(name);
    const jobId = seedJob(team, { title: "Crumb welder", status: "open" });
    const applicationId = seedApplicationAgo(team, jobId, "applied", HOUR, "Cand Crumb");
    const { context, page } = await newVisitor(browser);
    const org = `/en/org/${team.slug}`;
    await signInAtAal2(page, team.owner, team.ownerSecret, `${org}/applicants/${applicationId}`);

    const trail = breadcrumbs(page);
    await expect(trail.getByRole("listitem")).toHaveText([name, "Vacancies", "Crumb welder", "Applicants", "Cand Crumb"]);
    await expect(trail.getByRole("link")).toHaveCount(4);
    await expect(trail.locator('[aria-current="page"]')).toHaveText("Cand Crumb");
    await expect(trail.locator("a[aria-current]")).toHaveCount(0);
    await expectNoAxeViolations(page);

    await trail.getByRole("link", { name: "Applicants" }).click();
    await expect(page).toHaveURL(`${org}/applicants?job=${jobId}`);
    await expect(trail.getByRole("listitem")).toHaveText([name, "Vacancies", "Crumb welder", "Applicants"]);

    await trail.getByRole("link", { name: "Crumb welder" }).click();
    await expect(page).toHaveURL(`${org}/jobs/${jobId}`);
    await expect(trail.getByRole("listitem")).toHaveText([name, "Vacancies", "Crumb welder"]);
    await expect(page.getByRole("link", { name: /^Back to/ })).toHaveCount(0);

    await page.getByRole("link", { name: "Preview as candidates see it" }).click();
    await expect(trail.getByRole("listitem")).toHaveText([name, "Vacancies", "Crumb welder", "Preview"]);

    await trail.getByRole("link", { name: "Vacancies" }).click();
    await expect(page).toHaveURL(`${org}/jobs`);
    await expect(trail.getByRole("listitem")).toHaveText([name, "Vacancies"]);

    await page.getByRole("link", { name: "Create vacancy" }).click();
    await expect(trail.getByRole("listitem")).toHaveText([name, "Vacancies", "New vacancy"]);

    await page.goto(`${org}/members`);
    await expect(trail.getByRole("listitem")).toHaveText([name, "Team"]);

    await page.goto(`${org}/billing`);
    await expect(trail.getByRole("listitem")).toHaveText([name, "Billing"]);
    await page.goto(checkoutPath(team.slug));
    await expect(trail.getByRole("listitem")).toHaveText([name, "Billing", "Checkout"]);
    await trail.getByRole("link", { name: "Billing" }).click();
    await expect(page).toHaveURL(`${org}/billing`);

    await trail.getByRole("link", { name }).click();
    await expect(page).toHaveURL(`/en/dashboard/employer?org=${team.slug}`);
    await context.close();
  });

  test("the settings pages lead back to the dashboard, and an employer's notification settings have no Settings step", async ({ browser }) => {
    const worker = await createCommittedUser("worker");
    const session = await signedInPage(browser, worker);
    await session.page.goto("/en/settings/notifications");
    const trail = breadcrumbs(session.page);
    await expect(trail.getByRole("listitem")).toHaveText(["Dashboard", "Settings", "Notification settings"]);
    await expect(trail.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/en/settings");
    await trail.getByRole("link", { name: "Settings" }).click();
    await expect(session.page).toHaveURL("/en/settings");
    await expect(trail.getByRole("listitem")).toHaveText(["Dashboard", "Settings"]);
    await trail.getByRole("link", { name: "Dashboard" }).click();
    await expect(session.page).toHaveURL("/en/dashboard/worker");
    await session.context.close();

    const team = await newTeam();
    const employer = await signedInPage(browser, team.owner, { viewport: { width: 375, height: 812 } });
    await employer.page.goto("/en/settings/notifications");
    await expect(breadcrumbs(employer.page).getByRole("listitem")).toHaveText(["Dashboard", "Notification settings"]);
    await expectNoAxeViolations(employer.page);
    await employer.context.close();
  });
});
