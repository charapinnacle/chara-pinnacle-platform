import { randomUUID } from "node:crypto";
import { displayName, expectAccessibleAtBothWidths, newApplicant } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { signIn } from "./support/passport";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { newTeam, newVisitor, signInAtAal1, signInAtAal2, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// The submission review pipeline (V50; FR-O5 AC1, AC5, AC8 to AC10, AC12; NFR-U3, NFR-U4): the employer reads the
// approved candidates of a requirement in the list and on the board, each marked "Submitted by <partner>", never a request
// the candidate has not approved, and the count on the requirement page; reviews one, adds an internal note and moves it;
// moves six at once, three moved and three skipped, then declines two with one reason; the candidate reads the submission
// in the journey tracker with the partner's name and the reason; the partner reads the stages and their dates, never the
// note or the reason; an empty requirement, a stage filter without a match and a failed read. Releases 2a and 2b and
// candidate submissions are switched on for the whole database, so this file is a project of its own after the
// submission pages, and its tests run one after the other. The requirements are in Andorra, which no other spec uses.

const ANDORRA = "AD";
const LIST_FUNCTION = "public.list_employer_submissions(uuid, uuid, public.submission_status, integer, integer)";
const NOTE = "Strong welding test result";
const REASON = "The position was filled by a candidate with more experience.";

type Partner = { id: string; slug: string; displayName: string; owner: TestUser };

const pipelineUrl = (slug: string, requirement: string, extra = "") => `/en/org/${slug}/applicants?requirement=${requirement}${extra}`;
const detailUrl = (slug: string, id: string) => `/en/org/${slug}/applicants/submissions/${id}`;
const requirementUrl = (slug: string, id: string) => `/en/org/${slug}/requirements/${id}`;
const partnerCandidatesUrl = (slug: string, requirement: string) => `/en/org/${slug}/requirements/${requirement}/submissions`;

function setRelease(key: "release_job_orders" | "release_candidate_submissions", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

async function listedPartner(): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)};
     insert into billing.subscriptions (organization_id, plan_code, status, provider)
     values (${literal(id)}, 'recruitment_partner', 'active', 'null');`,
  );
  return { id, slug, displayName: displayName(id), owner: user };
}

// An open requirement of the team in Andorra that shows the employer's name.
function seedRequirement(team: Pick<Team, "id" | "owner">, title: string): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 20, ${literal(ANDORRA)}, 'Andorra la Vella', 'C', date '2027-03-01', 12,
       'full_time', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', 'job_order_marketplace', true, now(), date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 20);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(ANDORRA)});`,
  );
  return id;
}

// A submission as approve_submission leaves it (consent, share of the documents, snapshot, events) in p_status, or a
// request the candidate has not answered (awaiting_candidate) or declined.
function seedSubmission(requirement: string, partner: Partner, employer: string, worker: TestUser, status: string, documents: string[] = []): string {
  const id = randomUUID();
  const approved = !["awaiting_candidate", "declined_by_candidate"].includes(status);
  const share = randomUUID();
  execute(
    approved
      ? `with consent as (
           insert into public.consents (user_id, purpose, version, action)
           values (${literal(worker.id)}, ${literal(`share_passport:${employer}:submission:${id}`)}, private.current_legal_version('sharing-notice'), 'granted')
           returning id
         ), submission as (
           insert into public.candidate_submissions (id, requirement_id, organization_id, employer_organization_id, invited_email, worker_user_id,
             submitted_by, status, decided_at, worker_approved_at, passport_share_id, profile_snapshot, withdrawn_at)
           values (${literal(id)}, ${literal(requirement)}, ${literal(partner.id)}, ${literal(employer)}, ${literal(worker.email)}, ${literal(worker.id)},
             ${literal(partner.owner.id)}, ${literal(status)}, now(), now(), ${literal(share)}, private.profile_snapshot(${literal(worker.id)}),
             ${status === "withdrawn" ? "now()" : "null"})
           returning id
         )
         insert into public.passport_shares (id, worker_user_id, organization_id, submission_id, scope, consent_id)
         select ${literal(share)}, ${literal(worker.id)}, ${literal(employer)}, submission.id, ${literal(JSON.stringify(documents))}::jsonb, consent.id
         from consent, submission;
         insert into public.submission_events (submission_id, from_status, to_status, actor_id)
         values (${literal(id)}, 'awaiting_candidate', 'submitted', ${literal(worker.id)});`
      : `insert into public.candidate_submissions (id, requirement_id, organization_id, employer_organization_id, invited_email, worker_user_id,
           submitted_by, status, decided_at)
         values (${literal(id)}, ${literal(requirement)}, ${literal(partner.id)}, ${literal(employer)}, ${literal(worker.email)}, ${literal(worker.id)},
           ${literal(partner.owner.id)}, ${literal(status)}, ${status === "awaiting_candidate" ? "null" : "now()"});`,
  );
  return id;
}

function statusOf(id: string): string {
  return query<{ status: string }>(`select status::text from public.candidate_submissions where id = ${literal(id)}`)[0].status;
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  execute(`delete from public.workforce_requirements where country_code = ${literal(ANDORRA)}`);
  setPartnerRelease(true);
  setRelease("release_job_orders", true);
  setRelease("release_candidate_submissions", true);
});
test.afterAll(() => {
  execute(`grant execute on function ${LIST_FUNCTION} to authenticated`);
  setRelease("release_candidate_submissions", false);
  setRelease("release_job_orders", false);
  setPartnerRelease(false);
});

test.describe("Submission review pipeline (FR-O5)", () => {
  test("AC1, AC5, AC9, AC10: approved candidates in the pipeline with the partner; review, note, stages, tracker and partner view", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const team = await newTeam();
    const s1 = await listedPartner();
    const p1 = await listedPartner();
    const requirement = seedRequirement(team, "Andorra hotel welders");
    const [w1, w2, w3, waiting, declined] = await Promise.all([newApplicant(), newApplicant(), newApplicant(), newApplicant(), newApplicant()]);
    const certificate = await seedDocument(w1.id, { title: "Welding certificate", type: "certificate", scanStatus: "clean" });
    const id1 = seedSubmission(requirement, s1, team.id, w1, "submitted", [certificate.id]);
    seedSubmission(requirement, s1, team.id, w2, "submitted");
    seedSubmission(requirement, p1, team.id, w3, "submitted");
    seedSubmission(requirement, s1, team.id, waiting, "awaiting_candidate");
    seedSubmission(requirement, s1, team.id, declined, "declined_by_candidate");

    await signInAtAal2(page, team.owner, team.ownerSecret, pipelineUrl(team.slug, requirement));
    const list = page.getByRole("list", { name: "Submitted candidates" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(list.getByText(`Submitted by ${s1.displayName}`)).toHaveCount(2);
    await expect(list.getByText(`Submitted by ${p1.displayName}`)).toHaveCount(1);
    await expect(list.getByText("Submitted", { exact: true })).toHaveCount(3);
    await expect(page.getByText(waiting.email)).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    await page.getByRole("link", { name: "Board", exact: true }).click();
    await expect(page).toHaveURL(pipelineUrl(team.slug, requirement, "&view=board"));
    const board = page.getByRole("region", { name: "Board" });
    await expect(board.getByRole("heading", { level: 2 })).toHaveText([
      /^Submitted/, /^Viewed/, /^Shortlisted/, /^Interview/, /^Offer/, /^Hired/, /^Not selected/, /^Withdrawn/,
    ]);
    await expect(board.getByRole("region", { name: "Submitted, 3" }).getByText(`Submitted by ${s1.displayName}`)).toHaveCount(2);
    await expectAccessibleAtBothWidths(page);

    await page.goto(requirementUrl(team.slug, requirement));
    const section = page.getByRole("region", { name: "Submitted candidates" });
    await expect(section.getByText("3 candidates submitted by partners.")).toBeVisible();
    await expect(section.getByText(`Submitted by ${s1.displayName}: 2`)).toBeVisible();

    // The review: the first open moves Submitted to Viewed; the internal note is for the employer only (AC5).
    await page.goto(detailUrl(team.slug, id1));
    await expect(page.getByText(`Submitted by ${s1.displayName}`).first()).toBeVisible();
    await expect(page.getByText("Viewed", { exact: true }).first()).toBeVisible();
    expect(statusOf(id1)).toBe("viewed");
    await expect(page.getByText("Welding certificate")).toBeVisible();
    await expect(page.getByText("Internal, not visible to the candidate or the partner.").first()).toBeVisible();
    const add = page.getByRole("button", { name: "Add note" });
    await waitForHydration(add);
    await page.getByLabel("Add an internal note").fill(NOTE);
    await add.click();
    await expect(page.getByText("Note added", { exact: true })).toBeVisible();
    await expect(page.getByText(NOTE)).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    for (const [stage, toast] of [["Interview", "Interview"], ["Offer", "Offer"]] as const) {
      const change = page.getByRole("button", { name: "Change stage" });
      await waitForHydration(change);
      await change.click();
      const dialog = page.getByRole("dialog", { name: "Change stage" });
      await dialog.getByLabel("New stage").selectOption({ label: stage });
      await dialog.getByRole("button", { name: "Review" }).click();
      await dialog.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText(`Stage changed to ${toast}`)).toBeVisible();
    }
    expect(statusOf(id1)).toBe("offer");
    expect(
      query<{ kind: string }>(
        `select kind from public.notifications where payload ->> 'submission_id' = ${literal(id1)} and user_id = ${literal(w1.id)} order by created_at`,
      ).map((row) => row.kind),
    ).toEqual(["status_changed", "status_changed"]);

    // AC9: the candidate's journey tracker names the partner and shows the stages and Withdraw; no internal note.
    const candidate = await newVisitor(browser);
    await signIn(candidate.page, w1);
    await candidate.page.goto("/en/applications");
    const proposed = candidate.page.getByRole("link", { name: `Proposed by ${s1.displayName} for Andorra hotel welders` });
    await expect(proposed).toBeVisible();
    await proposed.click();
    await expect(candidate.page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(candidate.page.getByText("Interview").first()).toBeVisible();
    await expect(candidate.page.getByText("Offer").first()).toBeVisible();
    await expect(candidate.page.getByRole("button", { name: "Withdraw submission" })).toBeVisible();
    await expect(candidate.page.getByText(NOTE)).toHaveCount(0);
    await expectAccessibleAtBothWidths(candidate.page);
    await candidate.context.close();

    // AC10: the partner reads the stage and the dates of each change, never the note.
    const partner = await newVisitor(browser);
    await signInAtAal1(partner.page, s1.owner, partnerCandidatesUrl(s1.slug, requirement));
    const stages = partner.page.getByRole("list", { name: /^Stages of / });
    await expect(stages).toHaveCount(1);
    await expect(stages.getByRole("listitem")).toHaveText([/^Submitted /, /^Viewed by the employer /, /^Interview /, /^Offer /]);
    await expect(partner.page.getByText(/Last change/).first()).toBeVisible();
    await expect(partner.page.getByText(NOTE)).toHaveCount(0);
    await expectAccessibleAtBothWidths(partner.page);
    await partner.context.close();
  });

  test("AC8: six candidates moved at once, three skipped; two declined with one reason", async ({ page }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const s1 = await listedPartner();
    const requirement = seedRequirement(team, "Andorra tunnel welders");
    const workers = await Promise.all(Array.from({ length: 6 }, () => newApplicant()));
    const states = ["submitted", "submitted", "submitted", "interview", "interview", "withdrawn"];
    const ids = workers.map((worker, index) => seedSubmission(requirement, s1, team.id, worker, states[index]));

    await signInAtAal2(page, team.owner, team.ownerSecret, pipelineUrl(team.slug, requirement));
    const list = page.getByRole("list", { name: "Submitted candidates" });
    await expect(list.getByRole("listitem")).toHaveCount(6);
    const boxes = list.getByRole("checkbox");
    await waitForHydration(boxes.first());
    for (const box of await boxes.all()) await box.check();
    await expect(page.getByText("6 selected")).toBeVisible();
    await page.getByLabel("Action", { exact: true }).selectOption({ label: "Move to Shortlisted" });
    await page.getByRole("button", { name: "Review" }).click();
    const dialog = page.getByRole("dialog", { name: "Review the bulk action" });
    await expect(dialog.getByText("6 candidates")).toBeVisible();
    await expect(dialog.getByText(`(Submitted by ${s1.displayName})`)).toHaveCount(6);
    await expect(dialog.getByText("Candidates who withdrew, and candidates who cannot move to this stage from their current one, are skipped.", { exact: false })).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("3 moved, 3 skipped")).toBeVisible();
    expect(ids.map(statusOf)).toEqual(["shortlisted", "shortlisted", "shortlisted", "interview", "interview", "withdrawn"]);

    await page.reload();
    const interview = page.getByRole("list", { name: "Submitted candidates" }).getByRole("listitem").filter({ hasText: "Interview" });
    await expect(interview).toHaveCount(2);
    await waitForHydration(interview.first().getByRole("checkbox"));
    for (const box of await interview.getByRole("checkbox").all()) await box.check();
    await page.getByLabel("Action", { exact: true }).selectOption({ label: "Decline (Not selected)" });
    await page.getByLabel("Reason (visible to the candidate)").selectOption({ label: "Other" });
    await page.getByLabel("Other reason (visible to the candidate)").fill(REASON);
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("dialog", { name: "Review the bulk action" }).getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("2 moved, 0 skipped")).toBeVisible();
    expect(ids.slice(3, 5).map(statusOf)).toEqual(["rejected", "rejected"]);
    expect(
      query<{ n: number }>(
        `select count(*)::integer as n from public.submission_events
         where submission_id in (${ids.slice(3, 5).map(literal).join(", ")}) and to_status = 'rejected' and note = ${literal(REASON)}`,
      )[0].n,
    ).toBe(2);
    expect(
      query<{ n: number }>(
        `select count(*)::integer as n from public.notifications
         where kind = 'status_changed' and payload ->> 'status' = 'rejected' and payload ->> 'submission_id' in (${ids.slice(3, 5).map(literal).join(", ")})`,
      )[0].n,
    ).toBe(2);
  });

  test("AC12: an empty requirement, a filter without a match, a failed read with a retry, and not found while off", async ({ page }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    const requirement = seedRequirement(team, "Andorra bridge welders");

    await signInAtAal2(page, team.owner, team.ownerSecret, pipelineUrl(team.slug, requirement));
    await expect(page.getByText("No candidates have been submitted yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "See the partners selected for this requirement" })).toHaveAttribute(
      "href",
      `/en/org/${team.slug}/requirements/${requirement}/responses`,
    );
    await expectAccessibleAtBothWidths(page);

    await page.goto(`/en/org/${team.slug}/applicants?source=submissions`);
    await expect(page.getByText("No candidates match this filter")).toBeVisible();
    await page.getByRole("button", { name: "Clear filter" }).click();
    await expect(page).toHaveURL(`/en/org/${team.slug}/applicants`);
    await expectAccessibleAtBothWidths(page);

    await page.goto(pipelineUrl(team.slug, requirement));
    execute(`revoke execute on function ${LIST_FUNCTION} from authenticated`);
    try {
      await page.reload();
      await expect(page.getByText("The applicants could not be loaded").first()).toBeVisible();
      await expect(page.getByText("No candidates have been submitted yet")).toHaveCount(0);
      await expectNoAxeViolations(page);
    } finally {
      execute(`grant execute on function ${LIST_FUNCTION} to authenticated`);
    }
    const retry = page.getByRole("button", { name: "Try again" });
    await waitForHydration(retry);
    await retry.click();
    await expect(page.getByText("No candidates have been submitted yet")).toBeVisible();

    setRelease("release_candidate_submissions", false);
    try {
      await page.goto(pipelineUrl(team.slug, requirement));
      await expect(page.getByText("No candidates have been submitted yet")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Partner submissions" })).toHaveCount(0);
      await page.goto(detailUrl(team.slug, randomUUID()));
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    } finally {
      setRelease("release_candidate_submissions", true);
    }
  });
});
