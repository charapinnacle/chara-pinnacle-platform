import { readdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createUnconfirmedUser, pendingConsents } from "./support/accounts";
import { signInStaff } from "./support/admin";
import { seedDetailedApplication } from "./support/applicants";
import { expectAccessibleAtBothWidths, newApplicant, seedApplication } from "./support/applications";
import { execute, literal } from "./support/db";
import { newCompany, seedJob } from "./support/jobs";
import { createCommittedUser, generateRecoveryPath, requestReset, suspendProfile } from "./support/login";
import { logIn } from "./support/login-page";
import { enterCode } from "./support/mfa";
import { registerOrganization, uniqueName } from "./support/organizations";
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
  "/[lang]/employers": "/en/employers",
  "/[lang]/how-it-works": "/en/how-it-works",
  "/[lang]/imprint": "/en/imprint",
  "/[lang]/jobs": "/en/jobs",
  "/[lang]/jobs/[id]": `/en/jobs/${jobId}`,
  "/[lang]/report": `/en/report?type=job&job=${jobId}`,
  "/[lang]/legal": "/en/legal",
  "/[lang]/legal/[slug]": "/en/legal/terms-of-service",
  "/[lang]/pricing": "/en/pricing",
  "/[lang]/trust-safety": "/en/trust-safety",
});

const authPages = (confirmPath: string, resetPath: string, invitationToken: string): Pages => ({
  "/[lang]/login": "/en/login",
  "/[lang]/signup": "/en/signup",
  "/[lang]/forgot-password": "/en/forgot-password",
  "/[lang]/forgot-password/check-email": "/en/forgot-password/check-email",
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
  "/[lang]/reports": "/en/reports",
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
  "/[lang]/org/[slug]/applicants/[applicationId]/report": `/en/org/${slug}/applicants/${applicationId}/report`,
  "/[lang]/org/[slug]/billing": `/en/org/${slug}/billing`,
  "/[lang]/org/[slug]/billing/checkout": `/en/org/${slug}/billing/checkout?plan=employer_starter`,
});

const adminPages = (userId: string, organizationId: string, reportId: number): Pages => ({
  "/[lang]/admin": "/en/admin",
  "/[lang]/admin/users": "/en/admin/users",
  "/[lang]/admin/users/[id]": `/en/admin/users/${userId}`,
  "/[lang]/admin/organizations": "/en/admin/organizations",
  "/[lang]/admin/organizations/[id]": `/en/admin/organizations/${organizationId}`,
  "/[lang]/admin/statistics": "/en/admin/statistics",
  "/[lang]/admin/plans": "/en/admin/plans",
  "/[lang]/admin/plans/[code]": "/en/admin/plans/employer_starter",
  "/[lang]/admin/plans/overrides": "/en/admin/plans/overrides",
  "/[lang]/admin/settings": "/en/admin/settings",
  "/[lang]/admin/legal": "/en/admin/legal",
  "/[lang]/admin/audit": "/en/admin/audit",
  "/[lang]/admin/staff": "/en/admin/staff",
  "/[lang]/admin/mfa-reset": "/en/admin/mfa-reset",
  "/[lang]/admin/reports": "/en/admin/reports",
  "/[lang]/admin/reports/[id]": `/en/admin/reports/${reportId}`,
  "/[lang]/admin/retention": "/en/admin/retention",
  "/[lang]/admin/direct-hiring-rules": "/en/admin/direct-hiring-rules",
});

const trustSafetyPages = (jobId: string): Pages => ({
  "/[lang]/admin/moderation": "/en/admin/moderation",
  "/[lang]/admin/moderation/[id]": `/en/admin/moderation/${jobId}`,
  "/[lang]/admin/suspensions": "/en/admin/suspensions",
});

// The pages that belong to a state of the account rather than to a role.
// /post-job only redirects (to the new-vacancy page or the dashboard), so it renders nothing to sweep.
const accountStatePages = [
  "/[lang]/onboarding",
  "/[lang]/onboarding/security",
  "/[lang]/onboarding/welcome",
  "/[lang]/consent",
  "/[lang]/suspended",
  "/[lang]/mfa",
  "/[lang]/post-job",
];

// The pages of a release that is switched off while this sweep runs; their own specs switch it on and check them at
// both widths: notifications (in-app-notifications.spec.ts), the partner reviews of the console (partner-approval.spec.ts),
// the workforce profile (partner-geographies.spec.ts, partner-workforce-offer.spec.ts, partner-availability.spec.ts), the
// public partner profile with a complete listed partner and its members' preview of an unlisted one (partner-profile.spec.ts),
// the recruitment directory with results and empty (partner-search.spec.ts), the staffing directory with results, empty,
// over the search limit and with the available workforce results of an employer (staffing-directory.spec.ts), the
// public company page with vacancies, empty and as its administrator (company-page.spec.ts), the saved partners of an
// employer and the followed companies, with rows and empty (save-partner-follow.spec.ts), the moderation decisions
// and appeals of an organisation and of the console (partner-profile.spec.ts), the export of a user's own data, empty,
// being prepared and ready, as a candidate and a company user (data-export.spec.ts), and the recruitment and staffing
// segments of /[lang]/dashboard/[kind] with data, empty, failed and as a member (partner-dashboards.spec.ts). The team page
// /[lang]/org/[slug]/members of a recruitment or staffing company, as its owner, an admin and a member, empty and with
// members, and its invitation and sign-up pages, are checked in partner-team.spec.ts (the employer's are swept here). The
// ranking page /[lang]/legal/ranking is checked in ranking-transparency.spec.ts. The workforce requirements of an
// employer (release 2b), the list empty and with a draft, the form new, refused and in edit and a requirement as its owner
// and as a member, are checked in workforce-requirements.spec.ts; the partner suggestions of a requirement in
// partner-suggestions.spec.ts. The job order marketplace and job order pages of a partner (eligible, titles only, closed,
// empty and failed) and the public Job orders page are checked in job-orders.spec.ts. The invitations of a requirement
// (statuses, empty and failed, as a member and an owner) and the inbox and invitation pages of a partner (pending, full,
// accepted and declined) are checked in invitations.spec.ts. The comparison of the responses to a requirement (with
// decisions as an owner, as a member, with one column, empty and failed) and the decided responses of the employer and
// the partners are checked in response-decisions.spec.ts. The candidate's submission requests and submissions (pending,
// submitted by another partner, approved, declined, withdrawn, empty), the partner's submission form (refused, sent, at
// the limit) and lists (empty, with each status) and the employer's candidates of a requirement are checked in
// candidate-submissions.spec.ts; the employer's pipeline of submitted candidates (list, board, empty, no match) and a
// submitted candidate's page in submission-pipeline.spec.ts.
const releasedPages = [
  "/[lang]/appeals",
  "/[lang]/appeals/[id]",
  "/[lang]/admin/appeals",
  "/[lang]/admin/appeals/[id]",
  "/[lang]/companies",
  "/[lang]/companies/[slug]",
  "/[lang]/following",
  "/[lang]/job-orders",
  "/[lang]/legal/ranking",
  "/[lang]/notifications",
  "/[lang]/org/[slug]/applicants/submissions/[id]",
  "/[lang]/org/[slug]/find-employers",
  "/[lang]/org/[slug]/invitations",
  "/[lang]/org/[slug]/invitations/[id]",
  "/[lang]/org/[slug]/invitations/[id]/respond",
  "/[lang]/admin/partners",
  "/[lang]/admin/partners/[id]",
  "/[lang]/org/[slug]/job-orders",
  "/[lang]/org/[slug]/job-orders/[id]",
  "/[lang]/org/[slug]/job-orders/[id]/respond",
  "/[lang]/org/[slug]/requirements",
  "/[lang]/org/[slug]/requirements/[id]",
  "/[lang]/org/[slug]/requirements/[id]/edit",
  "/[lang]/org/[slug]/requirements/[id]/invitations",
  "/[lang]/org/[slug]/requirements/[id]/partners",
  "/[lang]/org/[slug]/requirements/[id]/responses",
  "/[lang]/org/[slug]/requirements/[id]/responses/[responseId]",
  "/[lang]/org/[slug]/requirements/[id]/responses/compare",
  "/[lang]/org/[slug]/requirements/[id]/submissions",
  "/[lang]/org/[slug]/requirements/[id]/submissions/new",
  "/[lang]/org/[slug]/responses",
  "/[lang]/org/[slug]/responses/[id]",
  "/[lang]/org/[slug]/responses/[id]/edit",
  "/[lang]/org/[slug]/requirements/new",
  "/[lang]/org/[slug]/saved-partners",
  "/[lang]/org/[slug]/submissions",
  "/[lang]/org/[slug]/workforce-profile",
  "/[lang]/org/[slug]/workforce-profile/preview",
  "/[lang]/partners/[slug]",
  "/[lang]/partners/recruitment",
  "/[lang]/partners/staffing",
  "/[lang]/settings/data-export",
  "/[lang]/submissions",
  "/[lang]/submissions/[id]",
];

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
      ...Object.keys(adminPages("", "", 0)),
      ...Object.keys(trustSafetyPages("")),
      ...accountStatePages,
      ...releasedPages,
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
    // The page after a reset request is only shown to a visitor who made the request.
    await requestReset(page, recovering.email);
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
    const ownerWithoutTwoStep = await createCommittedUser("company");
    await registerOrganization(ownerWithoutTwoStep, uniqueName("Sweep Bau GmbH"));
    const welcomedWorker = await createCommittedUser("worker");

    for (const [user, address] of [
      [uncommitted, "/en/onboarding"],
      [uncommittedCompany, "/en/onboarding"],
      [ownerWithoutTwoStep, "/en/onboarding/security"],
      [welcomedWorker, "/en/onboarding/welcome"],
      [reconsenting, "/en/consent"],
      [suspended, "/en/suspended"],
    ] as const) {
      const context = await browser.newContext();
      await signInBrowser(context, user);
      // The welcome screen is shown once, when the last step sets this cookie (lib/welcome-cookie.ts).
      if (user === welcomedWorker) {
        await context.addCookies([{ name: "chara_welcome", value: user.id, domain: "localhost", path: address }]);
      }
      await expectPage(await context.newPage(), address);
      await context.close();
    }
  });

  test("administration pages, as a platform administrator", async ({ page }) => {
    const team = await newTeam();
    seedJob(team, { title: "Listed welder", status: "open" });
    const listed = seedJob(team, { title: "Reported welder", status: "open" });
    const reportId = Number(execute(`insert into public.reports (target_type, job_id, category, details, good_faith_confirmed) values ('job', ${literal(listed)}, 'other', 'A report seeded for the sweep of the pages.', true) returning id`).trim().split("\n")[0]);
    const { user } = await signInStaff(page, "admin");
    await sweep(page, adminPages(user.id, team.id, reportId));
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
