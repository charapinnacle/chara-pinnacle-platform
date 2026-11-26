import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal } from "./support/db";
import { partnerWithCompany, setPartnerRelease, type PartnerType } from "./support/partners";
import { signInBrowser } from "./support/session";
import { newTeam, type Team } from "./support/team";
import { expect, test } from "./support/test";
import type { TestUser } from "./support/test-user";

// Partner dashboards, release 2b blocks (V55; FR-R3 AC1, AC4 to AC7; FR-R4 AC1, AC7; FR-O5 AC10; NFR-U3, NFR-U4).
// Releases 2a and 2b are switched on for the whole database, so this file is a project of its own after the named job
// orders. Its job orders are in Andorra, which no other spec uses, so the counts are those of this file; they are removed
// afterwards.

const ANDORRA = "AD";
const RECRUITMENT_QUESTION = "Which employers need workers I can recruit?";
const STAFFING_QUESTION = "Which employers need the workforce I can provide?";
const dashboardUrl = (segment: string, slug: string) => `/en/dashboard/${segment}?org=${slug}`;

type Partner = { user: TestUser; id: string; slug: string };

function setRelease(key: "release_job_orders" | "release_candidate_submissions", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

// A listed partner serving Andorra with welders, or with no profile at all.
async function listedPartner(type: PartnerType, profile: boolean): Promise<Partner> {
  const partner = await partnerWithCompany(type);
  if (profile) {
    execute(
      `insert into public.organization_geographies (organization_id, scope, country_code)
       values (${literal(partner.id)}, 'sources_from', 'PH'), (${literal(partner.id)}, 'serves_market', ${literal(ANDORRA)});
       insert into public.organization_occupations (organization_id, occupation_id) values (${literal(partner.id)}, '7212')`,
    );
  }
  execute(
    `update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day',
       submitted_at = now() - interval '2 days' where id = ${literal(partner.id)}`,
  );
  return partner;
}

// An open requirement of the team in Andorra, as publish_requirement leaves it.
function seedRequirement(team: Team, title: string, occupation: string, visibility: string): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 20, ${literal(ANDORRA)}, 'Andorra la Vella', 'C', date '2027-03-01',
       12, 'full_time', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', ${literal(visibility)}, false,
       now() - interval '1 hour', date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, ${literal(occupation)}, 20);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(ANDORRA)})`,
  );
  return id;
}

// A submission in p_status, approved (with a candidate, a share and a snapshot) from submitted on.
function seedSubmission(requirement: string, team: Team, partner: Partner, status: string): void {
  const id = randomUUID();
  const approved = !["awaiting_candidate", "declined_by_candidate", "expired"].includes(status);
  execute(
    `insert into public.candidate_submissions (id, requirement_id, organization_id, employer_organization_id, invited_email,
       worker_user_id, status, decided_at, worker_approved_at, passport_share_id, profile_snapshot)
     values (${literal(id)}, ${literal(requirement)}, ${literal(partner.id)}, ${literal(team.id)}, ${literal(`${id}@seed.test`)},
       ${approved ? literal(randomUUID()) : "null"}, ${literal(status)},
       ${status === "awaiting_candidate" ? "null" : "now()"}, ${approved ? "now()" : "null"},
       ${approved ? literal(randomUUID()) : "null"}, ${approved ? "'{}'::jsonb" : "null"})`,
  );
}

async function signedIn(browser: Browser, user: TestUser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  await signInBrowser(context, user);
  return { page: await context.newPage(), close: () => context.close() };
}

// The pages of spec §30's actions are in the sidebar, so the dashboard header repeats none of them.
async function expectNoHeaderLinks(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("main").locator("header").first().getByRole("link")).toHaveCount(0);
}

test.describe("Partner dashboards, release 2b (V55)", () => {
  test.describe.configure({ mode: "serial" });
  let acme: Team;

  test.beforeAll(async () => {
    // The submission pipeline, which runs earlier, leaves requirements in Andorra.
    execute(`delete from public.workforce_requirements where country_code = ${literal(ANDORRA)}`);
    setPartnerRelease(true);
    setRelease("release_job_orders", true);
    setRelease("release_candidate_submissions", false);
    acme = await newTeam();
  });
  test.afterAll(() => {
    execute(`delete from public.workforce_requirements where organization_id = ${literal(acme.id)}`);
    setRelease("release_candidate_submissions", false);
    setRelease("release_job_orders", false);
    setPartnerRelease(false);
  });

  test("FR-R3 AC1, AC4 to AC6, FR-O5 AC10: the recruitment blocks appear with their releases", async ({ browser }) => {
    test.setTimeout(150_000);
    const r = await listedPartner("recruitment_company", true);
    const fitting = seedRequirement(acme, "Acme welders for Andorra", "7212", "job_order_marketplace");
    seedRequirement(acme, "Acme drivers for Andorra", "5120", "job_order_marketplace");
    const invited = seedRequirement(acme, "Acme private welders", "7212", "private");
    execute(
      `insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, status, source)
       values (${literal(invited)}, ${literal(r.id)}, ${literal(acme.id)}, 'invited', 'directory');
       insert into public.partner_responses (requirement_id, organization_id, employer_organization_id, status, capacity,
         available_from, experience_note, fee_model, decided_at, submissions_allowed)
       values (${literal(fitting)}, ${literal(r.id)}, ${literal(acme.id)}, 'shortlisted', 20, date '2027-02-01',
         'Twelve years of placing certified welders in Europe.', 'on_request', now(), true)`,
    );

    const owner = await signedIn(browser, r.user);
    await owner.page.goto(dashboardUrl("recruitment", r.slug));
    await expect(owner.page.getByRole("heading", { level: 1 })).toHaveText(RECRUITMENT_QUESTION);
    const activity = owner.page.getByRole("region", { name: "Your activity" });
    await expect(activity.getByRole("link", { name: /^2 Fitting job orders/ })).toHaveAttribute("href", `/en/org/${r.slug}/job-orders`);
    await expect(activity.getByRole("link", { name: /^1 Invitations waiting/ })).toHaveAttribute("href", `/en/org/${r.slug}/invitations`);
    await expect(activity.getByRole("link", { name: /^1 Responses 1 shortlisted, 0 selected/ })).toHaveAttribute("href", `/en/org/${r.slug}/responses`);
    await expect(activity.getByRole("link", { name: /Candidates submitted/ })).toHaveCount(0);
    await expectNoHeaderLinks(owner.page);

    setRelease("release_candidate_submissions", true);
    for (const status of ["awaiting_candidate", "submitted", "hired", "rejected"]) seedSubmission(fitting, acme, r, status);
    await owner.page.reload();
    await expect(activity.getByRole("link", { name: /^4 Candidates submitted 1 hired/ })).toHaveAttribute("href", `/en/org/${r.slug}/submissions`);
    await expectAccessibleAtBothWidths(owner.page);
    setRelease("release_candidate_submissions", false);
    await owner.close();
  });

  test("FR-R4 AC1, AC7: a new staffing company reads its activity as numbers, without header actions", async ({ browser }) => {
    test.setTimeout(120_000);
    const s = await listedPartner("staffing_company", false);
    const owner = await signedIn(browser, s.user);
    await owner.page.goto(dashboardUrl("staffing", s.slug));
    await expect(owner.page.getByRole("heading", { level: 1 })).toHaveText(STAFFING_QUESTION);
    const activity = owner.page.getByRole("region", { name: "Your activity" });
    await expect(activity.getByRole("link", { name: /^0 Workforce requests/ })).toHaveAttribute("href", `/en/org/${s.slug}/job-orders`);
    await expect(activity.getByRole("link", { name: /^0 Invitations waiting/ })).toBeVisible();
    await expect(activity.getByRole("link", { name: /^0 Responses/ })).toBeVisible();
    await expectNoHeaderLinks(owner.page);
    await expectAccessibleAtBothWidths(owner.page);
    await owner.close();
  });
});
