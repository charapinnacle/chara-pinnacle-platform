import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal } from "./support/db";
import { partnerWithCompany, setPartnerRelease, type PartnerType } from "./support/partners";
import { signInBrowser } from "./support/session";
import { addMember, newTeam, signInAtAal2, type Team } from "./support/team";
import { expect, test } from "./support/test";

// The partner network part of the employer dashboard (V56; FR-R5 AC1, AC3, AC4, AC7 to AC10; NFR-U3, NFR-U4). Releases
// 2a and 2b are switched on for the whole database, so this file is a project of its own after the partner dashboards.
// Every count is of the file's own employers, so other data does not change them.

const QUESTION = "Who can help me fill my workforce requirement?";
const dashboardUrl = (slug: string) => `/en/dashboard/employer?org=${slug}`;

type Partner = { id: string; slug: string };

function setRelease(key: "release_job_orders" | "release_candidate_submissions", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

async function listedPartner(type: PartnerType): Promise<Partner> {
  const { id, slug } = await partnerWithCompany(type);
  execute(
    `update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)}`,
  );
  return { id, slug };
}

function seedRequirement(team: Team, title: string, status = "open"): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 20, 'DE', 'Hamburg', 'C', date '2027-03-01', 12, 'full_time',
       'international', 'both', ${literal(team.owner.id)}, ${literal(status)},
       ${status === "draft" ? "null" : "'job_order_marketplace'"}, false, ${status === "draft" ? "null" : "now() - interval '1 hour'"},
       ${status === "draft" ? "null" : "date '2027-03-31'"});
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 20);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, 'DE')`,
  );
  return id;
}

function invite(requirement: string, team: Team, partner: Partner, status: string): void {
  execute(
    `insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, status, source, viewed_at, responded_at)
     values (${literal(requirement)}, ${literal(partner.id)}, ${literal(team.id)}, ${literal(status)}, 'directory',
       ${status === "viewed" ? "now()" : "null"}, ${status === "responded" ? "now()" : "null"})`,
  );
}

function respond(requirement: string, team: Team, partner: Partner, status: string, version = 1): void {
  execute(
    `insert into public.partner_responses (requirement_id, organization_id, employer_organization_id, status, version, capacity,
       available_from, experience_note, fee_model, decided_at, submissions_allowed)
     values (${literal(requirement)}, ${literal(partner.id)}, ${literal(team.id)}, ${literal(status)}, ${version}, 20, date '2027-02-01',
       'Twelve years of placing certified welders in Europe.', 'on_request',
       ${status === "selected" ? "now()" : "null"}, ${status === "selected" ? "true" : "false"})`,
  );
}

function seedSubmission(requirement: string, team: Team, partner: Partner, status: string): void {
  const id = randomUUID();
  execute(
    `insert into public.candidate_submissions (id, requirement_id, organization_id, employer_organization_id, invited_email,
       worker_user_id, status, decided_at, worker_approved_at, passport_share_id, profile_snapshot)
     values (${literal(id)}, ${literal(requirement)}, ${literal(partner.id)}, ${literal(team.id)}, ${literal(`${id}@seed.test`)},
       ${literal(randomUUID())}, ${literal(status)}, now(), now(), ${literal(randomUUID())}, '{}'::jsonb)`,
  );
}

const region = (page: Page, name: string) => page.getByRole("region", { name });

test.describe("Employer dashboard, partner network (V56)", () => {
  test.describe.configure({ mode: "serial" });
  let acme: Team;
  let requirement: string;

  test.beforeAll(async () => {
    setPartnerRelease(true);
    setRelease("release_job_orders", true);
    setRelease("release_candidate_submissions", false);
    acme = await newTeam();
    const [r1, r2, s1] = await Promise.all([
      listedPartner("recruitment_company"),
      listedPartner("recruitment_company"),
      listedPartner("staffing_company"),
    ]);
    requirement = seedRequirement(acme, "Welders for Hamburg");
    seedRequirement(acme, "Fitters for Bremen");
    seedRequirement(acme, "Drivers draft", "draft");
    invite(requirement, acme, r1, "responded");
    invite(requirement, acme, r2, "viewed");
    invite(requirement, acme, s1, "responded");
    respond(requirement, acme, r1, "selected");
    respond(requirement, acme, s1, "updated", 2);
    execute(
      `insert into public.saved_items (organization_id, target_organization_id, saved_by)
       values (${literal(acme.id)}, ${literal(r1.id)}, ${literal(acme.owner.id)}), (${literal(acme.id)}, ${literal(s1.id)}, ${literal(acme.owner.id)})`,
    );
    setRelease("release_candidate_submissions", true);
    seedSubmission(requirement, acme, r1, "submitted");
    seedSubmission(requirement, acme, r1, "interview");
  });

  test.afterAll(() => {
    execute(`delete from public.workforce_requirements where organization_id = ${literal(acme.id)}`);
    setRelease("release_candidate_submissions", false);
    setRelease("release_job_orders", false);
    setPartnerRelease(false);
  });

  test("AC1, AC3, AC4, AC10: the owner reads each block with its state and next action", async ({ page }) => {
    test.setTimeout(150_000);
    await signInAtAal2(page, acme.owner, acme.ownerSecret, dashboardUrl(acme.slug));
    await expect(page.getByRole("heading", { level: 2, name: QUESTION })).toBeVisible();
    const network = region(page, QUESTION);
    await expect(network.getByRole("link", { name: "Post workforce requirement" })).toHaveAttribute("href", `/en/org/${acme.slug}/requirements/new`);
    await expect(network.getByRole("link", { name: "Find partners" }).first()).toHaveAttribute("href", "/en/partners/recruitment");
    await network.getByRole("link", { name: "Post workforce requirement" }).focus();
    await expect(network.getByRole("link", { name: "Post workforce requirement" })).toBeFocused();

    const requirements = region(page, "Workforce requirements");
    const item = requirements.getByRole("listitem").filter({ hasText: "Welders for Hamburg" });
    await expect(item).toContainText("2 responses");
    await expect(item).toContainText("1 selected");
    await expect(item).toContainText("Updated");
    await expect(item.getByRole("link", { name: "Decide on 1 response for Welders for Hamburg" })).toHaveAttribute(
      "href",
      `/en/org/${acme.slug}/requirements/${requirement}/responses`,
    );
    await expect(requirements.getByRole("listitem").filter({ hasText: "Fitters for Bremen" }).getByRole("link")).toHaveText(
      "Invite partners for Fitters for Bremen",
    );
    await expect(requirements.getByRole("term").filter({ hasText: "Drafts" })).toBeVisible();

    const partners = region(page, "Partners invited and selected");
    await expect(partners).toContainText("3 partners: 2 recruitment, 1 staffing");
    await expect(partners.getByRole("term").filter({ hasText: "Selected partners" }).locator("xpath=following-sibling::dd[1]")).toHaveText("1");

    const waiting = region(page, "Responses waiting for your decision");
    await expect(waiting).toContainText("Updated since you last opened them");
    await expect(waiting.getByRole("link", { name: "Compare the responses to Welders for Hamburg" })).toHaveAttribute(
      "href",
      `/en/org/${acme.slug}/requirements/${requirement}/responses/compare`,
    );

    const submissions = region(page, "Submitted candidates");
    await expect(submissions.getByRole("link", { name: "New, not opened yet: 1" })).toBeVisible();
    await expect(submissions.getByRole("link", { name: "Review 1 new candidate" })).toHaveAttribute(
      "href",
      `/en/org/${acme.slug}/applicants?source=submissions&stage=submitted`,
    );
    await expect(page.getByRole("link", { name: "Saved partners: 2" })).toHaveAttribute("href", `/en/org/${acme.slug}/saved-partners`);
    await expectAccessibleAtBothWidths(page);
  });

  test("AC8: a member reads the figures without the posting actions", async ({ browser }) => {
    test.setTimeout(120_000);
    const { user } = await addMember(acme, "member");
    const context = await browser.newContext();
    await signInBrowser(context, user);
    const page = await context.newPage();
    await page.goto(dashboardUrl(acme.slug));
    await expect(page.getByRole("heading", { level: 2, name: QUESTION })).toBeVisible();
    await expect(region(page, "Workforce requirements")).toContainText("Welders for Hamburg");
    await expect(page.getByRole("link", { name: "Post workforce requirement" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Post job" })).toHaveCount(0);
    await expect(region(page, QUESTION).getByRole("link", { name: "Find partners" }).first()).toBeVisible();
    await context.close();
  });

  test("AC9: a new employer is told what to do in every block", async ({ page }) => {
    test.setTimeout(120_000);
    const fresh = await newTeam();
    await signInAtAal2(page, fresh.owner, fresh.ownerSecret, dashboardUrl(fresh.slug));
    await expect(region(page, "Workforce requirements")).toContainText(
      "Post a workforce requirement to ask partners for a group of workers, for example 20 welders for Germany.",
    );
    await expect(region(page, "Workforce requirements").getByRole("link", { name: "Post workforce requirement" })).toBeVisible();
    await expect(region(page, "Partners invited and selected")).toContainText("Invite recruitment or staffing partners from a requirement.");
    await expect(region(page, "Saved partners")).toContainText("Save partners from their profile to find them here.");
    await expect(region(page, "Submitted candidates")).toContainText("No candidates submitted yet.");
    await expectAccessibleAtBothWidths(page);
  });

  test("AC7: the 2b blocks leave with job orders, the saved partners stay", async ({ page }) => {
    test.setTimeout(120_000);
    setRelease("release_job_orders", false);
    await signInAtAal2(page, acme.owner, acme.ownerSecret, dashboardUrl(acme.slug));
    await expect(page.getByRole("link", { name: "Saved partners: 2" })).toBeVisible();
    for (const name of ["Workforce requirements", "Partners invited and selected", "Responses waiting for your decision", "Submitted candidates"]) {
      await expect(region(page, name)).toHaveCount(0);
    }
    await expect(page.getByRole("link", { name: "Post workforce requirement" })).toHaveCount(0);
    setRelease("release_job_orders", true);
    await page.reload();
    await expect(region(page, "Workforce requirements")).toBeVisible();
  });
});
