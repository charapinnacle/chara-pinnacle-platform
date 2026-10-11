import { readdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createUnconfirmedUser, pendingConsents } from "./support/accounts";
import { signInStaff } from "./support/admin";
import { seedDetailedApplication } from "./support/applicants";
import { expectAccessibleAtBothWidths, newApplicant, seedApplication } from "./support/applications";
import { execute, literal } from "./support/db";
import { newCompany, seedJob } from "./support/jobs";
import { createCommittedUser, generateRecoveryPath, suspendProfile } from "./support/login";
import { logIn } from "./support/login-page";
import { enterCode } from "./support/mfa";
import { expectSecurityHeaders } from "./support/security-headers";
import { seedSaved } from "./support/saved";
import { signInBrowser } from "./support/session";
import { addMember, newTeam, seedInvitation, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";
import { createTestUser } from "./support/test-user";

// NFR-U1, NFR-U2 and NFR-S5 over the whole application: every page, as the role that can open it, at 1280 and 360 px.
// Each group maps the route of a page (its folder under app/[lang], route groups left out) to the address visited.
type Pages = Record<string, string>;

const publicPages = (jobId: string): Pages => ({
  "/[lang]": "/en",
  "/[lang]/about": "/en/about",
  "/[lang]/contact": "/en/contact",
  "/[lang]/how-it-works": "/en/how-it-works",
  "/[lang]/imprint": "/en/imprint",
  "/[lang]/jobs": "/en/jobs",
  "/[lang]/jobs/[id]": `/en/jobs/${jobId}`,
  "/[lang]/legal": "/en/legal",
  "/[lang]/legal/[slug]": "/en/legal/terms-of-service",
  "/[lang]/pricing": "/en/pricing",
  "/[lang]/trust-safety": "/en/trust-safety",
});

const authPages = (confirmPath: string, resetPath: string, invitationToken: string): Pages => ({
  "/[lang]/login": "/en/login",
  "/[lang]/signup": "/en/signup",
  "/[lang]/forgot-password": "/en/forgot-password",
  "/[lang]/verify-email": "/en/verify-email",
  "/[lang]/confirm-email": confirmPath,
  "/[lang]/reset-password": resetPath,
  "/[lang]/invitations/[token]": `/en/invitations/${invitationToken}`,
});

const workerPages = (applyJobId: string, applicationId: string): Pages => ({
  "/[lang]/dashboard/[kind]": "/en/dashboard/worker",
  "/[lang]/passport": "/en/passport",
  "/[lang]/applications": "/en/applications",
  "/[lang]/applications/[id]": `/en/applications/${applicationId}`,
  "/[lang]/jobs/[id]/apply": `/en/jobs/${applyJobId}/apply`,
  "/[lang]/saved": "/en/saved",
  "/[lang]/settings": "/en/settings",
  "/[lang]/settings/notifications": "/en/settings/notifications",
  "/[lang]/forbidden": "/en/forbidden",
});

const employerPages = (slug: string, jobId: string, applicationId: string): Pages => ({
  "/[lang]/dashboard/[kind]": "/en/dashboard/employer",
  "/[lang]/org/[slug]": `/en/org/${slug}`,
  "/[lang]/org/[slug]/profile": `/en/org/${slug}/profile`,
  "/[lang]/org/[slug]/members": `/en/org/${slug}/members`,
  "/[lang]/org/[slug]/jobs": `/en/org/${slug}/jobs`,
  "/[lang]/org/[slug]/jobs/new": `/en/org/${slug}/jobs/new`,
  "/[lang]/org/[slug]/jobs/[id]": `/en/org/${slug}/jobs/${jobId}`,
  "/[lang]/org/[slug]/jobs/[id]/edit": `/en/org/${slug}/jobs/${jobId}/edit`,
  "/[lang]/org/[slug]/jobs/[id]/preview": `/en/org/${slug}/jobs/${jobId}/preview`,
  "/[lang]/org/[slug]/applicants": `/en/org/${slug}/applicants?job=${jobId}`,
  "/[lang]/org/[slug]/applicants/[applicationId]": `/en/org/${slug}/applicants/${applicationId}`,
  "/[lang]/org/[slug]/billing": `/en/org/${slug}/billing`,
  "/[lang]/org/[slug]/billing/checkout": `/en/org/${slug}/billing/checkout?plan=employer_starter`,
});

const adminPages = (userId: string, organizationId: string): Pages => ({
  "/[lang]/admin": "/en/admin",
  "/[lang]/admin/users": "/en/admin/users",
  "/[lang]/admin/users/[id]": `/en/admin/users/${userId}`,
  "/[lang]/admin/organizations": "/en/admin/organizations",
  "/[lang]/admin/organizations/[id]": `/en/admin/organizations/${organizationId}`,
  "/[lang]/admin/statistics": "/en/admin/statistics",
  "/[lang]/admin/legal": "/en/admin/legal",
  "/[lang]/admin/audit": "/en/admin/audit",
  "/[lang]/admin/staff": "/en/admin/staff",
  "/[lang]/admin/mfa-reset": "/en/admin/mfa-reset",
});

const trustSafetyPages = (jobId: string): Pages => ({
  "/[lang]/admin/moderation": "/en/admin/moderation",
  "/[lang]/admin/moderation/[id]": `/en/admin/moderation/${jobId}`,
  "/[lang]/admin/suspensions": "/en/admin/suspensions",
});

// The pages that belong to a state of the account rather than to a role.
// /post-job only redirects (to the new-vacancy page or the dashboard), so it renders nothing to sweep.
const accountStatePages = ["/[lang]/onboarding", "/[lang]/consent", "/[lang]/suspended", "/[lang]/mfa", "/[lang]/post-job"];

async function expectPage(page: Page, address: string): Promise<void> {
  const response = await page.goto(address);
  const { pathname } = new URL(address, "http://localhost");
  expect(response?.status(), address).toBe(200);
  expect(new URL(page.url()).pathname, address).toBe(pathname);
  await expect(page.getByRole("heading", { name: "Page not found" }), address).toHaveCount(0);
  expectSecurityHeaders((await response?.allHeaders()) ?? {}, pathname);
  await expectAccessibleAtBothWidths(page);
}

async function sweep(page: Page, pages: Pages): Promise<void> {
  for (const address of Object.values(pages)) await expectPage(page, address);
}

function routesOnDisk(directory: string, route = "/[lang]"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isFile()) return entry.name === "page.tsx" ? [route] : [];
    const segment = /^\(.+\)$/.test(entry.name) ? "" : `/${entry.name}`;
    return routesOnDisk(path.join(directory, entry.name), `${route}${segment}`);
  });
}

test.describe("accessibility and header sweep of every page (NFR-U1, NFR-U2, NFR-S5)", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the sweep names every page of the application", () => {
    const swept = new Set([
      ...Object.keys(publicPages("")),
      ...Object.keys(authPages("", "", "")),
      ...Object.keys(workerPages("", "")),
      ...Object.keys(employerPages("", "", "")),
      ...Object.keys(adminPages("", "")),
      ...Object.keys(trustSafetyPages("")),
      ...accountStatePages,
    ]);
    expect([...swept].sort()).toEqual(routesOnDisk(path.join(__dirname, "../../app/[lang]")).sort());
  });

  test("public pages, as a visitor", async ({ page }) => {
    const company = await newCompany();
    await sweep(page, publicPages(seedJob(company, { title: "Sweep welder", status: "open" })));
  });

  test("sign-in pages and the invitation, as a visitor", async ({ page }) => {
    const unconfirmed = await createUnconfirmedUser("worker");
    const recovering = await createCommittedUser("worker");
    const team = await newTeam();
    const token = seedInvitation(team, `invitee-${team.slug}@example.test`);
    await sweep(page, authPages(unconfirmed.confirmPath, await generateRecoveryPath(recovering.email), token));
  });

  test("candidate pages, as a candidate", async ({ page, context }) => {
    const company = await newCompany();
    const worker = await newApplicant();
    const appliedJob = seedJob(company, { title: "Applied welder", status: "open" });
    const applicationId = seedApplication(worker.id, appliedJob, company.id);
    const openJob = seedJob(company, { title: "Open welder", status: "open" });
    seedSaved(worker.id, openJob);
    await signInBrowser(context, worker);
    await sweep(page, workerPages(openJob, applicationId));
  });

  test("employer pages, as an owner at aal2, and the two-step challenge", async ({ page }) => {
    const team = await newTeam();
    const jobId = seedJob(team, { title: "Sweep crane operator", status: "open" });
    const applicationId = seedDetailedApplication(await newApplicant(), jobId, team);
    const { "/[lang]/org/[slug]": hub, ...pages } = employerPages(team.slug, jobId, applicationId);
    const billing = pages["/[lang]/org/[slug]/billing"];

    await logIn(page, team.owner, billing);
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent(billing)}`);
    expectSecurityHeaders((await page.request.get(page.url())).headers(), "/en/mfa");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterCode(page, team.ownerSecret);
    await expect(page).toHaveURL(billing);
    await sweep(page, pages);

    // The address of the organisation only leads to its dashboard; what it shows itself is the notice of a suspension.
    execute(`update public.organizations set status = 'suspended' where id = ${literal(team.id)}`);
    await expectPage(page, hub);
    await expect(page.getByRole("heading", { name: "This organisation is suspended" })).toBeVisible();
  });

  // A member sees the vacancy and applicant pages without the controls of a manager, and no two-step challenge.
  test("employer pages, as an organisation member", async ({ page, context }) => {
    const team = await newTeam();
    const jobId = seedJob(team, { title: "Member crane operator", status: "open" });
    const applicationId = seedDetailedApplication(await newApplicant(), jobId, team);
    const pages = employerPages(team.slug, jobId, applicationId);
    const { user } = await addMember(team, "member");
    await signInBrowser(context, user);
    await sweep(page, {
      dashboard: pages["/[lang]/dashboard/[kind]"],
      members: pages["/[lang]/org/[slug]/members"],
      jobs: pages["/[lang]/org/[slug]/jobs"],
      job: pages["/[lang]/org/[slug]/jobs/[id]"],
      preview: pages["/[lang]/org/[slug]/jobs/[id]/preview"],
      applicants: pages["/[lang]/org/[slug]/applicants"],
      applicant: pages["/[lang]/org/[slug]/applicants/[applicationId]"],
    });
    await page.goto(pages["/[lang]/org/[slug]/billing"]);
    await expect(page).toHaveURL("/en/forbidden");
    await expectPage(page, "/en/forbidden");
  });

  // An administrator manages the organisation like the owner, except for what only the owner may do.
  test("management pages, as an organisation administrator at aal2", async ({ page }) => {
    const team = await newTeam();
    const pages = employerPages(team.slug, "", "");
    const admin = await addMember(team, "admin");
    if (!admin.secret) throw new Error("The admin has no factor");
    await signInAtAal2(page, admin.user, admin.secret, pages["/[lang]/org/[slug]/billing"]);
    await sweep(page, {
      dashboard: pages["/[lang]/dashboard/[kind]"],
      profile: pages["/[lang]/org/[slug]/profile"],
      members: pages["/[lang]/org/[slug]/members"],
      billing: pages["/[lang]/org/[slug]/billing"],
    });
  });

  test("account states: onboarding, updated documents and suspension", async ({ browser }) => {
    const uncommitted = await createTestUser("worker", await pendingConsents("worker"));
    const uncommittedCompany = await createTestUser("company", await pendingConsents("company"));
    const reconsenting = await createCommittedUser("worker");
    execute(
      `insert into public.consents (user_id, purpose, version, action)
       select ${literal(reconsenting.id)}, 'terms-of-service', private.current_legal_version('terms-of-service'), 'withdrawn'`,
    );
    const suspended = await createCommittedUser("worker");
    suspendProfile(suspended.id);

    for (const [user, address] of [
      [uncommitted, "/en/onboarding"],
      [uncommittedCompany, "/en/onboarding"],
      [reconsenting, "/en/consent"],
      [suspended, "/en/suspended"],
    ] as const) {
      const context = await browser.newContext();
      await signInBrowser(context, user);
      await expectPage(await context.newPage(), address);
      await context.close();
    }
  });

  test("administration pages, as a platform administrator", async ({ page }) => {
    const team = await newTeam();
    seedJob(team, { title: "Listed welder", status: "open" });
    const { user } = await signInStaff(page, "admin");
    await sweep(page, adminPages(user.id, team.id));
  });

  test("moderation and suspension pages, as trust and safety", async ({ page }) => {
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Moderated welder", status: "open" });
    execute(
      `insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, created_at)
       values ('job', ${literal(jobId)}, 'job_hidden', 'Reported as a duplicate listing.', now() - interval '1 hour'),
              ('job', ${literal(jobId)}, 'job_unhidden', 'The report was mistaken.', now())`,
    );
    await signInStaff(page, "trust_safety");
    await sweep(page, trustSafetyPages(jobId));
  });
});
