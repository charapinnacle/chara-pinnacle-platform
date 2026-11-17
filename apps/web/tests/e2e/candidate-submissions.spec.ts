import { randomUUID } from "node:crypto";
import { displayName, expectAccessibleAtBothWidths, newApplicant } from "./support/applications";
import { callAs } from "./support/accounts";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { signIn } from "./support/passport";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { enforceLimits, newTeam, newVisitor, restoreLimits, signInAtAal1, signInAtAal2, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// The candidate submission pages (V49; FR-O4 AC2, AC5, AC7 to AC12, steps Request, Approve, Decline, Withdraw, Protect;
// NFR-C4, NFR-S9, NFR-U3, NFR-U4): a selected partner goes from its response to the form, is refused at the fields, sends
// requests (one for a double press) and follows them in its lists; the candidate approves with two of three documents and
// the consent, withdraws, declines another request and reads only Decline when another partner already submitted them;
// a request to an address without an account appears once a worker with that address opens Submissions, never for
// another worker; the employer reads the approved candidate; an empty list and a failed one with a retry; every page not
// found while candidate submissions are off. Releases 2a and 2b, candidate submissions and the plan limits are switched on
// for the whole database, so this file is a project of its own after the decisions, and its tests run one after the
// other. The requirements are in San Marino, which no other spec uses.

const SAN_MARINO = "SM";
const LIST_FUNCTION = "public.list_partner_submissions(uuid, uuid, uuid, integer)";
const WORKERS_NEVER_PAY = "Workers never pay fees to get a job through Chara Pinnacle";

type Partner = { id: string; slug: string; displayName: string; owner: TestUser };

const responseUrl = (slug: string, id: string) => `/en/org/${slug}/responses/${id}`;
const candidatesUrl = (slug: string, requirement: string) => `/en/org/${slug}/requirements/${requirement}/submissions`;
const newUrl = (slug: string, requirement: string) => `${candidatesUrl(slug, requirement)}/new`;
const partnerListUrl = (slug: string) => `/en/org/${slug}/submissions`;
const SUBMISSIONS_URL = "/en/submissions";
const submissionUrl = (id: string) => `${SUBMISSIONS_URL}/${id}`;

function setRelease(key: "release_job_orders" | "release_candidate_submissions", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

// A listed recruitment company serving San Marino with 7212 on the paid plan (25 submissions a month), with the
// employer-pays commitment accepted.
async function eligiblePartner(): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code) values
       (${literal(id)}, 'serves_market', ${literal(SAN_MARINO)}), (${literal(id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)};
     insert into billing.subscriptions (organization_id, plan_code, status, provider)
     values (${literal(id)}, 'recruitment_partner', 'active', 'null');
     insert into public.consents (user_id, purpose, version, action)
     select ${literal(user.id)}, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted'
     where not private.partner_commitment_current(${literal(id)});`,
  );
  return { id, slug, displayName: displayName(id), owner: user };
}

// An open job order of the team in San Marino without the company name, 20 welders (7212), starting 1 March 2027.
function seedJobOrder(team: Pick<Team, "id" | "owner">, title: string): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 20, ${literal(SAN_MARINO)}, 'Serravalle', 'C', date '2027-03-01', 12,
       'full_time', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', 'job_order_marketplace', false, now(), date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 20);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(SAN_MARINO)})`,
  );
  return id;
}

// The partner's response as decide_response leaves a selection: submissions are open to it (FR-O3 AC8).
function seedSelectedResponse(team: Pick<Team, "id" | "owner">, requirement: string, partner: string): string {
  const id = randomUUID();
  execute(
    `insert into public.partner_responses (id, requirement_id, organization_id, employer_organization_id, status, capacity, available_from,
       experience_note, fee_model, created_at, updated_at, decided_at, decided_by, submissions_allowed)
     values (${literal(id)}, ${literal(requirement)}, ${literal(partner)}, ${literal(team.id)}, 'selected', 20, date '2027-01-10',
       'Welding crews placed in San Marino for ten years', 'on_request', now() - interval '1 hour', now() - interval '1 hour', now(),
       ${literal(team.owner.id)}, true)`,
  );
  return id;
}

// A request as submit_candidate leaves it: linked to the worker, or, with worker null, to an address without an account.
function seedRequest(
  requirement: string,
  partner: Partner,
  employer: string,
  response: string,
  email: string,
  worker: string | null,
  note: string | null = null,
): string {
  const id = randomUUID();
  execute(
    `insert into public.candidate_submissions (id, requirement_id, organization_id, employer_organization_id, response_id, invited_email,
       worker_user_id, submitted_by, note)
     values (${literal(id)}, ${literal(requirement)}, ${literal(partner.id)}, ${literal(employer)}, ${literal(response)}, ${literal(email)},
       ${worker ? literal(worker) : "null"}, ${literal(partner.owner.id)}, ${note ? literal(note) : "null"});
     insert into public.submission_events (submission_id, from_status, to_status, actor_id)
     values (${literal(id)}, null, 'awaiting_candidate', ${literal(partner.owner.id)})`,
  );
  return id;
}

function submissionRow(id: string) {
  return query<{ status: string; worker_approved_at: string | null; passport_share_id: string | null }>(
    `select status::text, worker_approved_at, passport_share_id from public.candidate_submissions where id = ${literal(id)}`,
  )[0];
}

function submissionsTo(email: string) {
  return query<{ id: string; status: string; note: string | null }>(
    `select id, status::text, note from public.candidate_submissions where invited_email = ${literal(email)} order by created_at`,
  );
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  execute(`delete from public.workforce_requirements where country_code = ${literal(SAN_MARINO)}`);
  setPartnerRelease(true);
  setRelease("release_job_orders", true);
  setRelease("release_candidate_submissions", true);
  enforceLimits();
});
test.afterAll(() => {
  execute(`grant execute on function ${LIST_FUNCTION} to authenticated`);
  restoreLimits();
  setRelease("release_candidate_submissions", false);
  setRelease("release_job_orders", false);
  setPartnerRelease(false);
});

test.describe("Candidate submissions (FR-O4)", () => {
  test("AC12, AC2: a selected partner sends requests from its response, refused at the fields, one request for a double press", async ({ page }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const s1 = await eligiblePartner();
    const requirement = seedJobOrder(team, "San Marino quarry welders");
    const response = seedSelectedResponse(team, requirement, s1.id);

    await signInAtAal1(page, s1.owner, candidatesUrl(s1.slug, requirement));
    await expect(page.getByText("No candidates submitted yet")).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    await page.goto(responseUrl(s1.slug, response));
    await page.getByRole("link", { name: "Submit a candidate" }).click();
    await expect(page).toHaveURL(newUrl(s1.slug, requirement));
    await expect(page.getByRole("heading", { name: "Submit a candidate", level: 1 })).toBeVisible();
    await expect(page.getByText("0 of 25 submissions used this month")).toBeVisible();
    await expect(page.getByText(WORKERS_NEVER_PAY)).toBeVisible();

    const email = page.getByLabel("Candidate's email address");
    const note = page.getByLabel("Note to the candidate (optional)");
    const send = page.getByRole("button", { name: "Send request" });
    await waitForHydration(send);
    await email.fill("not-an-email");
    await send.click();
    await expect(page.getByText("Enter a valid email address, like name@example.com.").first()).toBeVisible();
    await email.fill(`${"a".repeat(243)}@example.com`);
    await send.click();
    await expect(page.getByText("The email address must have 254 characters or fewer.").first()).toBeVisible();
    const address = `cand-${randomUUID()}@example.test`;
    await email.fill(address);
    await note.fill("n".repeat(1001));
    await send.click();
    await expect(page.getByText("The note must have 1,000 characters or fewer.").first()).toBeVisible();
    await expectNoAxeViolations(page);
    expect(submissionsTo(address)).toEqual([]);

    await note.fill("Ten years of MIG welding");
    await send.click();
    await expect(page.getByText("Request sent", { exact: true })).toBeVisible();
    await expect(email).toHaveValue("");
    expect(submissionsTo(address)).toMatchObject([{ status: "awaiting_candidate", note: "Ten years of MIG welding" }]);

    const second = `cand-${randomUUID()}@example.test`;
    await email.fill(second);
    await send.dblclick();
    await expect(page.getByText("Request sent", { exact: true }).first()).toBeVisible();
    await expect.poll(() => submissionsTo(second).length).toBe(1);
    await page.reload();
    await expect(page.getByText("2 of 25 submissions used this month")).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    // At the month's limit Send request is disabled with the upgrade prompt as its reason, shown once (FR-R1).
    execute(
      `insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value)
       values (${literal(s1.id)}, 'candidate_submissions_per_month', 2)`,
    );
    try {
      await page.reload();
      const blocked = page.getByRole("button", { name: "Send request" });
      await expect(blocked).toBeDisabled();
      await expect(blocked).toHaveAccessibleDescription(/2 of 2 .*submissions/);
      await expect(page.getByRole("link", { name: "Upgrade your plan" })).toHaveCount(1);
      await expectAccessibleAtBothWidths(page);
    } finally {
      execute(`delete from billing.organization_limit_overrides where organization_id = ${literal(s1.id)} and limit_key = 'candidate_submissions_per_month'`);
    }

    // The list shows the address entered until the candidate approves, with the status in words (AC2, AC12).
    await page.goto(partnerListUrl(s1.slug));
    const list = page.getByRole("list", { name: "Candidates" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByRole("heading", { name: address })).toBeVisible();
    await expect(list.getByText("Awaiting candidate")).toHaveCount(2);
    await expect(list.locator(`a[href="${candidatesUrl(s1.slug, requirement)}"]`)).toHaveCount(2);
    await expectAccessibleAtBothWidths(page);
  });

  test("AC5, AC9, AC11: the candidate approves with two of three documents, then withdraws", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const s1 = await eligiblePartner();
    const requirement = seedJobOrder(team, "San Marino bridge welders");
    const response = seedSelectedResponse(team, requirement, s1.id);
    const worker = await newApplicant();
    await seedDocument(worker.id, { title: "Passport scan", type: "certificate", scanStatus: "clean" });
    const welding = await seedDocument(worker.id, { title: "Welding certificate", type: "certificate", scanStatus: "clean" });
    const reference = await seedDocument(worker.id, { title: "Reference letter", type: "certificate", scanStatus: "clean" });
    const id = seedRequest(requirement, s1, team.id, response, worker.email, worker.id, "We placed you in Rimini last year");

    await signIn(page, worker);
    await page.goto(SUBMISSIONS_URL);
    await expect(page.getByRole("heading", { name: "Waiting for your answer" })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.locator(`a[href="${submissionUrl(id)}"]`).click();
    await expect(page).toHaveURL(submissionUrl(id));

    // Before the approval: the partner, the requirement without the employer's name, destination, start, what is shared.
    await expect(page.getByText(`${s1.displayName} would like to submit you`)).toBeVisible();
    await expect(page.getByText("Not named by the employer")).toBeVisible();
    await expect(page.getByText("San Marino").first()).toBeVisible();
    await expect(page.getByText("1 March 2027")).toBeVisible();
    await expect(page.getByText("We placed you in Rimini last year")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What will be shared" })).toBeVisible();
    await expect(page.getByText(displayName(team.id))).toHaveCount(0);
    await expect(page.getByText(WORKERS_NEVER_PAY)).toBeVisible();
    const report = page.getByRole("link", { name: `Report a fee demand by ${s1.displayName}` });
    await expect(report).toHaveAttribute("href", `/en/report?type=partner_profile&partner=${s1.slug}&category=fee_demanded_from_worker`);
    await expectAccessibleAtBothWidths(page);

    const approve = page.getByRole("button", { name: "Approve and share" });
    await waitForHydration(approve);
    await approve.click();
    await expect(page.getByText("Confirm that you agree to share your profile and the selected documents").first()).toBeVisible();
    expect(submissionRow(id).status).toBe("awaiting_candidate");
    await page.getByRole("checkbox", { name: "Welding certificate" }).check();
    await page.getByRole("checkbox", { name: "Reference letter" }).check();
    await page
      .getByRole("checkbox", {
        name: /^I agree to share my profile and the selected documents with the employer for this submission, as the sharing notice describes$/,
      })
      .check();
    await approve.click();
    await expect(page.getByText("Request approved", { exact: true })).toBeVisible();
    await expect(page.getByText("Submitted", { exact: true })).toBeVisible();

    const row = submissionRow(id);
    expect(row.status).toBe("submitted");
    expect(row.worker_approved_at).not.toBeNull();
    const [share] = query<{ scope: string[]; organization_id: string; revoked_at: string | null }>(
      `select scope, organization_id, revoked_at from public.passport_shares where submission_id = ${literal(id)}`,
    );
    expect(share.organization_id).toBe(team.id);
    expect([...share.scope].sort()).toEqual([welding.id, reference.id].sort());
    expect(
      query<{ n: number }>(
        `select count(*)::integer as n from public.consents where user_id = ${literal(worker.id)}
           and purpose = ${literal(`share_passport:${team.id}:submission:${id}`)} and action = 'granted'`,
      )[0].n,
    ).toBe(1);
    await expect(page.getByText(WORKERS_NEVER_PAY)).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    // The employer reads the approved candidate with the partner (step Deliver) in the pipeline of the requirement (V50),
    // where the notice's link leads; the partner reads the name, not the address.
    const employer = await newVisitor(browser);
    await signInAtAal2(employer.page, team.owner, team.ownerSecret, `/en/org/${team.slug}/requirements`);
    await employer.page.goto(candidatesUrl(team.slug, requirement));
    await expect(employer.page).toHaveURL(new RegExp(`/en/org/${team.slug}/applicants\\?requirement=${requirement}$`));
    const employerList = employer.page.getByRole("list", { name: "Submitted candidates" });
    await expect(employerList.getByRole("link", { name: "Test Candidate" })).toBeVisible();
    await expect(employerList.getByText(`Submitted by ${s1.displayName}`)).toBeVisible();
    await expect(employer.page.getByText(worker.email)).toHaveCount(0);
    await expectAccessibleAtBothWidths(employer.page);
    await employer.context.close();

    const partner = await newVisitor(browser);
    await signInAtAal1(partner.page, s1.owner, candidatesUrl(s1.slug, requirement));
    await expect(partner.page.getByRole("heading", { name: "Test Candidate" })).toBeVisible();
    await expect(partner.page.getByText("Submitted", { exact: true })).toBeVisible();
    await expect(partner.page.getByText(worker.email)).toHaveCount(0);
    await partner.context.close();

    // AC9: Withdraw after a confirmation; the share is revoked at once.
    const withdraw = page.getByRole("button", { name: "Withdraw submission" });
    await waitForHydration(withdraw);
    await withdraw.click();
    const dialog = page.getByRole("dialog", { name: "Withdraw this submission?" });
    await expect(dialog).toContainText("The employer loses access to your profile and documents immediately.");
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("Submission withdrawn", { exact: true })).toBeVisible();
    await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Withdraw submission" })).toHaveCount(0);
    expect(submissionRow(id).status).toBe("withdrawn");
    expect(query<{ revoked: boolean }>(`select revoked_at is not null as revoked from public.passport_shares where submission_id = ${literal(id)}`)[0].revoked).toBe(
      true,
    );
  });

  test("AC7, AC8: the candidate declines; a request for a requirement another partner submitted them to offers only Decline", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const s1 = await eligiblePartner();
    const s2 = await eligiblePartner();
    const requirement = seedJobOrder(team, "San Marino tunnel welders");
    const r1 = seedSelectedResponse(team, requirement, s1.id);
    const r2 = seedSelectedResponse(team, requirement, s2.id);
    const worker = await newApplicant();
    await callAs(worker, "approve_submission", { p_submission: seedRequest(requirement, s1, team.id, r1, worker.email, worker.id), p_document_ids: [] });
    const second = seedRequest(requirement, s2, team.id, r2, worker.email, worker.id);

    await signIn(page, worker);
    await page.goto(submissionUrl(second));
    await expect(page.getByText(`You have already been proposed for this requirement by ${s1.displayName}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve and share" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    const decline = page.getByRole("button", { name: "Decline request" });
    await waitForHydration(decline);
    await decline.click();
    const dialog = page.getByRole("dialog", { name: "Decline this request?" });
    await expect(dialog).toContainText("Nothing is shared with the employer.");
    await dialog.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(page.getByText("Request declined", { exact: true })).toBeVisible();
    await expect(page.getByText("You declined this request. Nothing was shared with the employer.")).toBeVisible();
    expect(submissionRow(second)).toMatchObject({ status: "declined_by_candidate", passport_share_id: null });

    // The second partner reads "Declined by candidate" and the address, never the first partner's submission.
    const partner = await newVisitor(browser);
    await signInAtAal1(partner.page, s2.owner, partnerListUrl(s2.slug));
    await expect(partner.page.getByText("Declined by candidate")).toBeVisible();
    await expect(partner.page.getByText(s1.displayName)).toHaveCount(0);
    await expectAccessibleAtBothWidths(partner.page);
    await partner.context.close();
  });

  test("AC10: a request to an address without an account appears once a worker with that address opens Submissions, never for another", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    const s1 = await eligiblePartner();
    const requirement = seedJobOrder(team, "San Marino dome welders");
    const response = seedSelectedResponse(team, requirement, s1.id);
    const worker = await newApplicant();
    const id = seedRequest(requirement, s1, team.id, response, worker.email, null);

    const other = await newVisitor(browser);
    await signIn(other.page, await newApplicant());
    await other.page.goto(SUBMISSIONS_URL);
    await expect(other.page.getByText("No submission requests yet")).toBeVisible();
    await expectAccessibleAtBothWidths(other.page);
    await other.page.goto(submissionUrl(id));
    await expect(other.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await other.context.close();

    await signIn(page, worker);
    await page.goto(SUBMISSIONS_URL);
    await expect(page.getByRole("link", { name: "Submissions" }).first()).toBeVisible();
    await page.locator(`a[href="${submissionUrl(id)}"]`).click();
    await expect(page).toHaveURL(submissionUrl(id));
    await expect(page.getByRole("button", { name: "Approve and share" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Decline request" })).toBeVisible();
    expect(query<{ worker_user_id: string }>(`select worker_user_id from public.candidate_submissions where id = ${literal(id)}`)[0].worker_user_id).toBe(
      worker.id,
    );
  });

  test("a failed list shows a toast and a retry; every page is not found while candidate submissions are off", async ({ page }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    const s1 = await eligiblePartner();
    const requirement = seedJobOrder(team, "San Marino tower welders");
    seedSelectedResponse(team, requirement, s1.id);

    await signInAtAal1(page, s1.owner, partnerListUrl(s1.slug));
    await expect(page.getByText("No candidates submitted yet")).toBeVisible();
    execute(`revoke execute on function ${LIST_FUNCTION} from authenticated`);
    try {
      await page.reload();
      await expect(page.getByText("Your candidates could not be loaded").first()).toBeVisible();
      await expectNoAxeViolations(page);
    } finally {
      execute(`grant execute on function ${LIST_FUNCTION} to authenticated`);
    }
    const retry = page.getByRole("button", { name: "Try again" });
    await waitForHydration(retry);
    await retry.click();
    await expect(page.getByText("No candidates submitted yet")).toBeVisible();

    setRelease("release_candidate_submissions", false);
    try {
      for (const address of [partnerListUrl(s1.slug), candidatesUrl(s1.slug, requirement), newUrl(s1.slug, requirement)]) {
        await page.goto(address);
        await expect(page.getByRole("heading", { name: "Page not found" }), address).toBeVisible();
      }
      await expect(page.getByRole("link", { name: "Submissions" })).toHaveCount(0);
    } finally {
      setRelease("release_candidate_submissions", true);
    }
  });
});
