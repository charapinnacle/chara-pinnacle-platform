import { randomUUID } from "node:crypto";
import { signInStaff } from "./support/admin";
import { displayName, expectAccessibleAtBothWidths, newApplicant } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { signIn } from "./support/passport";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { fillReport, sendReport } from "./support/reports";
import { newTeam, newVisitor, signInAtAal1, signInAtAal2, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// Moderation of the job order network (V57; FR-S1 AC1, AC4, AC8, AC10, AC12; FR-J3 AC8 from a submission; NFR-C7,
// NFR-U3). A candidate reports a fee demand from the submission, the employer reports a response, a partner reports a job
// order, each from the page of the item; Trust & Safety hide them with a statement of reasons; the partner reads the
// badge and the reasons on its response and the employer no longer opens it. Releases 2a, 2b and candidate submissions
// are switched on for the whole database, so this file is a project of its own after the employer dashboard. The job
// orders are in Cyprus, which no other spec uses.

const CYPRUS = "CY";
const REASONS = "The response claims licences the company does not hold, against the platform rules.";

type Partner = { id: string; slug: string; displayName: string; owner: TestUser };

function setRelease(key: "release_job_orders" | "release_candidate_submissions", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

async function listedPartner(): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code) values (${literal(id)}, 'serves_market', ${literal(CYPRUS)});
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)}`,
  );
  return { id, slug, displayName: displayName(id), owner: user };
}

function seedJobOrder(team: Team, title: string): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 20, ${literal(CYPRUS)}, 'Limassol', 'C', date '2027-03-01', 12,
       'full_time', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', 'job_order_marketplace', false, now(), date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 20);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(CYPRUS)})`,
  );
  return id;
}

function seedResponse(team: Team, requirement: string, partner: Partner): string {
  const id = randomUUID();
  execute(
    `insert into public.partner_responses (id, requirement_id, organization_id, employer_organization_id, status, capacity, available_from,
       experience_note, fee_model, created_by)
     values (${literal(id)}, ${literal(requirement)}, ${literal(partner.id)}, ${literal(team.id)}, 'submitted', 20, date '2027-01-10',
       'Welding crews placed in Cyprus for ten years.', 'on_request', ${literal(partner.owner.id)})`,
  );
  return id;
}

// A request as submit_candidate leaves it, linked to the worker.
function seedRequest(team: Team, requirement: string, partner: Partner, worker: TestUser): string {
  const id = randomUUID();
  execute(
    `insert into public.candidate_submissions (id, requirement_id, organization_id, employer_organization_id, invited_email,
       worker_user_id, submitted_by, note)
     values (${literal(id)}, ${literal(requirement)}, ${literal(partner.id)}, ${literal(team.id)}, ${literal(worker.email)},
       ${literal(worker.id)}, ${literal(partner.owner.id)}, 'Strong welder, ready to travel.');
     insert into public.submission_events (submission_id, from_status, to_status, actor_id)
     values (${literal(id)}, null, 'awaiting_candidate', ${literal(partner.owner.id)})`,
  );
  return id;
}

function reportOf(column: "requirement_id" | "partner_response_id" | "candidate_submission_id", id: string) {
  return query<{ id: number; target_type: string; category: string; organization_id: string | null; status: string }>(
    `select id, target_type::text, category::text, organization_id, status::text from public.reports where ${column} = ${literal(id)}`,
  );
}

test.describe("Moderation of job orders, responses and submissions (V57)", () => {
  test.describe.configure({ mode: "serial" });
  let acme: Team;
  let alpha: Partner;
  let requirement: string;
  let response: string;

  test.beforeAll(async () => {
    setPartnerRelease(true);
    setRelease("release_job_orders", true);
    setRelease("release_candidate_submissions", true);
    acme = await newTeam();
    alpha = await listedPartner();
    requirement = seedJobOrder(acme, "Welders for the Limassol shipyard");
    response = seedResponse(acme, requirement, alpha);
  });
  test.afterAll(() => {
    execute(`delete from public.workforce_requirements where country_code = ${literal(CYPRUS)}`);
    setRelease("release_candidate_submissions", false);
    setRelease("release_job_orders", false);
    setPartnerRelease(false);
  });

  test("FR-J3 AC8, FR-S1 AC1: the candidate reports a fee demand from the submission and Trust & Safety read it without the candidate", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const worker = await newApplicant();
    const submission = seedRequest(acme, requirement, alpha, worker);
    await signIn(page, worker);
    await page.goto(`/en/submissions/${submission}`);
    const link = page.getByRole("link", { name: `Report a fee demand by ${alpha.displayName}` });
    await expect(link).toHaveAttribute("href", `/en/report?type=candidate_submission&submission=${submission}&category=fee_demanded_from_worker`);
    await link.click();
    await expect(page.getByRole("heading", { name: "Report a submission", level: 1 })).toBeVisible();
    await expect(page.getByLabel("What is wrong")).toHaveValue("fee_demanded_from_worker");
    await expect(page.getByLabel("What is wrong").locator("option:checked")).toHaveText("The company asked me to pay a fee");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await fillReport(page, { details: "The recruiter asked me for 900 euros before the interview." });
    const reference = await sendReport(page);
    await expect(page.getByText("Trust & Safety handles reports of fee demands first.")).toBeVisible();
    const [stored] = reportOf("candidate_submission_id", submission);
    expect(stored).toMatchObject({ target_type: "candidate_submission", category: "fee_demanded_from_worker", organization_id: null, status: "new" });

    const staff = await newVisitor(browser);
    await signInStaff(staff.page, "trust_safety", `/en/admin/reports/${stored.id}`);
    await expect(staff.page.getByRole("heading", { name: `Report ${reference}`, level: 1 })).toBeVisible();
    const target = staff.page.locator("#target");
    // The kind of item is in the summary of the report (About); the section below holds the item itself.
    await expect(staff.page.getByRole("term").filter({ hasText: /^About$/ }).locator("xpath=following-sibling::dd[1]")).toHaveText("Candidate submission");
    await expect(target).toContainText("Strong welder, ready to travel.");
    await expect(target).toContainText(alpha.displayName);
    await expect(target).toContainText("The candidate is not shown to staff");
    expect(await staff.page.locator("main").innerText()).not.toContain(worker.email);
    await expect(staff.page.getByRole("button", { name: "Hide", exact: true })).toBeVisible();
    await expect(staff.page.getByRole("button", { name: "Suspend organisation" })).toBeVisible();
    await expectAccessibleAtBothWidths(staff.page);
    await staff.context.close();
  });

  test("FR-S1 AC4, AC10, AC12: the employer reports a response, Trust & Safety hide it, the partner reads the badge and the reasons", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await signInAtAal2(page, acme.owner, acme.ownerSecret, `/en/org/${acme.slug}/requirements/${requirement}/responses/${response}`);
    const reportLink = page.getByRole("link", { name: "Report this response" });
    await expect(reportLink).toHaveAttribute("href", `/en/report?type=partner_response&response=${response}`);
    await reportLink.click();
    await expect(page.getByRole("heading", { name: "Report a response", level: 1 })).toBeVisible();
    await fillReport(page, { category: "misleading_or_fraud", details: "The response claims licences for Cyprus that the company does not hold." });
    await sendReport(page);
    const [stored] = reportOf("partner_response_id", response);
    expect(stored).toMatchObject({ target_type: "partner_response", status: "new" });

    const staff = await newVisitor(browser);
    await signInStaff(staff.page, "trust_safety", `/en/admin/reports/${stored.id}`);
    await expect(staff.page.locator("#target")).toContainText("Welding crews placed in Cyprus for ten years.");
    const hide = staff.page.getByRole("button", { name: "Hide", exact: true });
    await waitForHydration(hide);
    await hide.focus();
    await staff.page.keyboard.press("Enter");
    const dialog = staff.page.getByRole("dialog", { name: "Hide the partner response" });
    await expect(dialog).toContainText(`Organisation:${alpha.displayName}`);
    await expect(dialog.getByLabel("Statement of reasons")).toBeFocused();
    await staff.page.keyboard.type(REASONS);
    await dialog.getByRole("button", { name: "Hide" }).focus();
    await staff.page.keyboard.press("Enter");
    await expect(staff.page.getByText("Hidden. The report is actioned", { exact: true })).toBeVisible();
    await expect(staff.page.locator("#decision")).toContainText("Partner response hidden");
    await staff.context.close();

    expect(query<{ action: string; report_id: number }>(
      `select action, report_id from public.moderation_actions where target_type = 'partner_response' and target_id = ${literal(response)}`,
    )).toEqual([{ action: "content_hidden", report_id: stored.id }]);
    expect(query<{ target_type: string; reasons: string }>(
      `select payload ->> 'target_type' as target_type, payload ->> 'reasons' as reasons from public.notifications
       where kind = 'moderation_decision' and user_id = ${literal(alpha.owner.id)}`,
    )).toEqual([{ target_type: "partner_response", reasons: REASONS }]);
    // The page streams behind its loading state, so the not-found page comes with status 200: what it shows is checked.
    await page.goto(`/en/org/${acme.slug}/requirements/${requirement}/responses/${response}`);
    await expect(page.getByRole("heading", { name: "Page not found" }), "hidden from the employer").toBeVisible();

    const partner = await newVisitor(browser);
    await signInAtAal1(partner.page, alpha.owner, `/en/org/${alpha.slug}/responses/${response}`);
    const notice = partner.page.getByRole("status").filter({ hasText: "Hidden by moderation" });
    await expect(notice).toContainText("This response is hidden");
    await expect(notice).toContainText(REASONS);
    await expectAccessibleAtBothWidths(partner.page);
    await partner.context.close();
  });

  test("FR-S1 AC1, AC2: a partner reports a job order from its page; a visitor is asked to log in", async ({ page }) => {
    test.setTimeout(180_000);
    const other = seedJobOrder(acme, "Fitters for the Larnaca port");
    await signInAtAal1(page, alpha.owner, `/en/org/${alpha.slug}/job-orders/${other}`);
    const link = page.getByRole("link", { name: "Report this job order" });
    await expect(link).toHaveAttribute("href", `/en/report?type=requirement&requirement=${other}`);
    await link.click();
    await fillReport(page, { category: "discrimination", details: "The job order asks for workers of one nationality only." });
    await sendReport(page);
    expect(reportOf("requirement_id", other)).toMatchObject([{ target_type: "requirement", category: "discrimination", status: "new" }]);

    await page.context().clearCookies();
    await page.goto(`/en/report?type=requirement&requirement=${other}`);
    await expect(page.getByRole("link", { name: "Log in to report it" })).toBeVisible();
    await expect(page.getByLabel("What happened")).toHaveCount(0);
    expect((await page.request.get(`/en/report?type=requirement&requirement=not-an-id`)).status()).toBe(404);
  });
});
