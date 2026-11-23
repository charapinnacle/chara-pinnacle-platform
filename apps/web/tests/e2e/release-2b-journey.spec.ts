import type { Page } from "@playwright/test";
import { displayName, expectAccessibleAtBothWidths, newApplicant } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { chooseFromList } from "./support/jobs";
import { uniqueToken } from "./support/organizations";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { signIn } from "./support/passport";
import { newTeam, newVisitor, signInAtAal1, signInAtAal2, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";
import { pickDate } from "./support/date-picker";

// NFR-O4 (V79): the two journeys of release 2b, walked through the real pages, with the status and the next action of
// each page on the way (NFR-U4). (a) An employer posts a workforce requirement, publishes it to the job order
// marketplace without its name and invites a partner from its profile; the partner opens the invitation from its
// notification, accepts it and sends a response; the employer compares the responses and selects the partner, who then
// reads the decision and the employer's name. (b) The selected partner submits a candidate by email; the candidate
// approves and shares a document; the employer finds the candidate in the pipeline of the requirement and opens it, and
// the partner and the candidate follow each stage. Only the starting point is written to the database (a team, a listed
// partner on a paid plan with the employer-pays commitment, a worker with a document). Releases 2a and 2b and candidate
// submissions are switched on for the whole database while this file runs, so it is a project of its own at the end of
// the release 2b chain (playwright.config.ts). The requirement is in Slovenia, which no other spec uses.

const SLOVENIA = "SI";

type Partner = { id: string; slug: string; displayName: string; owner: TestUser };

function setRelease(key: "release_job_orders" | "release_candidate_submissions", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

// A listed recruitment company serving Slovenia with 7212, sourcing from the Philippines, on the paid Basic plan and
// with the employer-pays commitment accepted, as the partner sign-up and review of release 2a leave it.
async function listedPartner(): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code)
       values (${literal(id)}, 'serves_market', ${literal(SLOVENIA)}), (${literal(id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)};
     insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(id)}, 'recruitment_partner', 'active', 'null');
     insert into public.consents (user_id, purpose, version, action)
     select ${literal(user.id)}, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted'
     where not private.partner_commitment_current(${literal(id)});`,
  );
  return { id, slug, displayName: displayName(id), owner: user };
}

function statusButtons(page: Page) {
  return page.getByRole("region", { name: "Status actions" }).getByRole("button");
}

function statusRegion(page: Page) {
  return page.getByRole("region", { name: "Status" });
}

function startDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

function kinds(userId: string): string[] {
  return query<{ kind: string }>(`select kind from public.notifications where user_id = ${literal(userId)} order by created_at`).map(
    ({ kind }) => kind,
  );
}

// What journey (a) leaves for journey (b).
let team: Team;
let partner: Partner;
let requirement: string;
let response: string;
let title: string;

test.describe("release 2b journeys (NFR-O4, NFR-U4)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => {
    execute(`delete from public.workforce_requirements where country_code = ${literal(SLOVENIA)}`);
    setPartnerRelease(true);
    setRelease("release_job_orders", true);
    setRelease("release_candidate_submissions", true);
  });
  test.afterAll(() => {
    setRelease("release_candidate_submissions", false);
    setRelease("release_job_orders", false);
    setPartnerRelease(false);
  });

  test("(a) a requirement is published, a partner is invited, responds and is selected", async ({ page, browser }) => {
    test.setTimeout(420_000);
    team = await newTeam();
    partner = await listedPartner();
    const employer = displayName(team.id);
    title = `Ljubljana shipyard welders ${uniqueToken()}`;

    // The employer posts the requirement: a draft first, whose status says partners do not see it yet.
    await signInAtAal2(page, team.owner, team.ownerSecret, `/en/org/${team.slug}/requirements/new`);
    await waitForHydration(page.getByLabel("Number of workers", { exact: true }));
    await page.getByLabel("Title (optional)", { exact: true }).fill(title);
    await page.getByLabel("Number of workers", { exact: true }).fill("100");
    await chooseFromList(page, "Country", "Slovenia", /^Slovenia$/);
    await page.getByLabel("City or region", { exact: true }).fill("Ljubljana");
    await chooseFromList(page, "Industry", "Manufacturing", "Manufacturing");
    await chooseFromList(page, "Occupation 1", "weld", "Welders and flame cutters");
    await page.getByLabel("Quantity of Welders and flame cutters", { exact: true }).fill("100");
    await pickDate(page.getByLabel("Start date", { exact: true }), startDate(120));
    await page.getByLabel("Employment type").selectOption({ value: "full_time" });
    await page.getByLabel("Salary minimum").fill("2400");
    await page.getByLabel("Salary maximum").fill("2900");
    await chooseFromList(page, "Currency", "EUR", /^EUR /);
    await page.getByLabel("Pay period").selectOption({ value: "month" });
    await page.getByLabel("Recruitment preference").selectOption({ value: "international" });
    await page.getByLabel("Need workforce partners?").selectOption({ value: "recruitment" });
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/requirements\/[0-9a-f-]{36}$/);
    requirement = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Draft - not visible to partners" })).toBeVisible();
    await expect(statusButtons(page)).toHaveText(["Publish"]);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // Published to the marketplace without the company name: open, with the actions of an open requirement.
    await waitForHydration(statusButtons(page).first());
    await statusButtons(page).first().click();
    const publish = page.getByRole("dialog", { name: "Publish this requirement" });
    await publish.getByRole("radio", { name: "Job order marketplace", exact: true }).check();
    await expect(publish.getByRole("checkbox", { name: "Show our company name" })).not.toBeChecked();
    await publish.getByRole("button", { name: "Publish requirement" }).click();
    await expect(page.getByText("The requirement is published", { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Open - partners can respond" })).toBeVisible();
    await expect(page.getByText("Job order marketplace, without your company name", { exact: true })).toBeVisible();
    await expect(statusButtons(page)).toHaveText(["Pause", "Close", "Mark as filled", "Extend by 30 days"]);

    // The partner is invited from its profile in Find Partners.
    await page.goto(`/en/partners/${partner.slug}`);
    const invite = page.getByRole("button", { name: `Invite ${partner.displayName}`, exact: true });
    await waitForHydration(invite);
    await invite.click();
    const inviteDialog = page.getByRole("dialog", { name: `Invite ${partner.displayName} to a requirement` });
    await inviteDialog.getByRole("radio", { name: title }).check();
    await expectNoAxeViolations(page);
    await inviteDialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`Invitation sent to ${partner.displayName}`, { exact: true })).toBeVisible();
    const [invitation] = query<{ id: string; status: string }>(
      `select id, status::text from public.requirement_invitations where requirement_id = ${literal(requirement)}
         and organization_id = ${literal(partner.id)}`,
    );
    expect(invitation.status).toBe("invited");

    // The partner opens the invitation from its notification: the employer is named to it, with what to do next.
    const partnerView = await newVisitor(browser);
    const pp = partnerView.page;
    await signInAtAal1(pp, partner.owner, "/en/notifications");
    const item = pp.getByRole("link", { name: `${employer} invited your company to "${title}"` });
    await waitForHydration(item);
    await item.click();
    await expect(pp).toHaveURL(`/en/org/${partner.slug}/invitations/${invitation.id}`);
    await expect(pp.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await pp.reload();
    await expect(statusRegion(pp).getByText("Not answered", { exact: true })).toBeVisible();
    await expect(statusRegion(pp)).toContainText("Read the requirement, then accept or decline the invitation. The employer sees your answer.");
    await expect(pp.getByRole("main")).toContainText(`${employer} invited your company on`);
    await expectAccessibleAtBothWidths(pp);
    await pp.setViewportSize({ width: 1280, height: 900 });

    // It accepts and sends its response from the form Accept opens.
    const accept = pp.getByRole("button", { name: "Accept", exact: true });
    await waitForHydration(accept);
    await accept.click();
    await pp.getByRole("dialog", { name: "Accept this invitation?" }).getByRole("button", { name: "Accept invitation" }).click();
    await expect(pp).toHaveURL(`/en/org/${partner.slug}/invitations/${invitation.id}/respond`);
    await expect(pp.getByRole("heading", { name: "Respond to this invitation", level: 1 })).toBeVisible();
    const send = pp.getByRole("button", { name: "Send response" });
    await waitForHydration(send);
    await pp.getByLabel("Workers you can supply").fill("80");
    await pickDate(pp.getByLabel("Available from"), startDate(90));
    await pp.getByLabel("Relevant experience").fill("We placed welding crews in shipyards on the Adriatic coast for twelve years.");
    await pp.getByRole("radio", { name: "Fee per hire" }).check();
    await pp.getByLabel("Amount").fill("1200.00");
    await pp.getByLabel("Guarantee period (days)").fill("90");
    await expect(pp.getByRole("combobox", { name: "Currency", exact: true }), "the fee currency starts on the requirement's salary currency").toHaveValue("Euro");
    await expectAccessibleAtBothWidths(pp);
    await pp.setViewportSize({ width: 1280, height: 900 });
    await send.click();
    await expect(pp.getByText("Response sent", { exact: true })).toBeVisible();
    await expect(pp).toHaveURL(/\/responses\/[0-9a-f-]{36}$/);
    response = new URL(pp.url()).pathname.split("/").at(-1) ?? "";
    await expect(statusRegion(pp).getByText("Sent", { exact: true })).toBeVisible();
    await expect(statusRegion(pp)).toContainText("The employer has your response. You can change or withdraw it until the employer decides.");
    await expectAccessibleAtBothWidths(pp);
    await pp.setViewportSize({ width: 1280, height: 900 });
    await pp.goto(`/en/org/${partner.slug}/invitations/${invitation.id}`);
    await expect(statusRegion(pp).getByText("Responded", { exact: true })).toBeVisible();
    await expect(statusRegion(pp)).toContainText("You responded to this invitation. Open your response to read, change or withdraw it.");
    expect(kinds(team.owner.id)).toContain("response_received");

    // The employer reads the response with its next step, compares and selects the partner.
    await page.goto(`/en/org/${team.slug}/requirements/${requirement}/invitations`);
    const invited = page.getByRole("list", { name: "Invited partners" }).getByRole("listitem").filter({ hasText: partner.displayName });
    await expect(invited.getByText("Responded", { exact: true })).toBeVisible();
    await page.goto(`/en/org/${team.slug}/requirements/${requirement}/responses/${response}`);
    await expect(page.getByRole("heading", { name: partner.displayName, level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Read the proposal and its documents.");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/en/org/${team.slug}/requirements/${requirement}/responses/compare`);
    const select = page.getByRole("button", { name: `Select ${partner.displayName}`, exact: true });
    await waitForHydration(select);
    await select.click();
    const selectDialog = page.getByRole("dialog", { name: `Select ${partner.displayName}?` });
    await expect(selectDialog).toContainText("can then submit candidates for this requirement");
    await selectDialog.getByRole("button", { name: `Select ${partner.displayName}`, exact: true }).click();
    await expect(page.getByText("Partner selected", { exact: true })).toBeVisible();
    await page.goto(`/en/org/${team.slug}/requirements/${requirement}/responses/${response}`);
    await expect(page.getByRole("main")).toContainText("You selected this partner. It can submit candidates for this requirement.");
    await expect(page.getByRole("button", { name: /^(Shortlist|Select|Decline) / })).toHaveCount(0);
    await page.goto(`/en/org/${team.slug}/requirements/${requirement}`);
    await expect(page.getByText(`Selected partner: ${partner.displayName}`)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Open - partners can respond" })).toBeVisible();
    expect(
      query<{ status: string; submissions_allowed: boolean }>(
        `select status::text, submissions_allowed from public.partner_responses where id = ${literal(response)}`,
      )[0],
    ).toEqual({ status: "selected", submissions_allowed: true });

    // The partner reads the decision, the employer's name and its next step: submitting candidates.
    await pp.goto(`/en/org/${partner.slug}/responses/${response}`);
    await expect(statusRegion(pp).getByText("Selected", { exact: true })).toBeVisible();
    await expect(statusRegion(pp)).toContainText(
      "The employer selected your company for this requirement, so the response can no longer be changed or withdrawn.",
    );
    await expect(statusRegion(pp)).toContainText("The employer allows your company to submit candidates for this requirement.");
    await expect(statusRegion(pp).getByRole("link", { name: "Submit a candidate" })).toBeVisible();
    await expect(pp.getByText(employer).first()).toBeVisible();
    await expectAccessibleAtBothWidths(pp);
    await partnerView.context.close();
    expect(kinds(partner.owner.id)).toEqual(expect.arrayContaining(["invitation_received", "response_decided"]));
  });

  test("(b) the selected partner submits a candidate, who approves, and the employer reviews them in its pipeline", async ({
    page,
    browser,
  }) => {
    test.setTimeout(360_000);
    const worker = await newApplicant();
    const certificate = await seedDocument(worker.id, { title: "Welding certificate", type: "certificate", scanStatus: "clean" });
    const candidatesUrl = `/en/org/${partner.slug}/requirements/${requirement}/submissions`;

    // The partner sends the request from its response.
    await signInAtAal1(page, partner.owner, `/en/org/${partner.slug}/responses/${response}`);
    await page.getByRole("link", { name: "Submit a candidate" }).click();
    await expect(page).toHaveURL(`${candidatesUrl}/new`);
    const sendRequest = page.getByRole("button", { name: "Send request" });
    await waitForHydration(sendRequest);
    await page.getByLabel("Candidate's email address").fill(worker.email);
    await page.getByLabel("Note to the candidate (optional)").fill("We placed you in Koper last year");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await sendRequest.click();
    await expect(page.getByText("Request sent", { exact: true })).toBeVisible();
    const [submission] = query<{ id: string; status: string }>(
      `select id, status::text from public.candidate_submissions where requirement_id = ${literal(requirement)}
         and invited_email = ${literal(worker.email)}`,
    );
    expect(submission.status).toBe("awaiting_candidate");
    await page.goto(candidatesUrl);
    const candidates = page.getByRole("list", { name: "Candidates" });
    await expect(candidates.getByText("Awaiting candidate", { exact: true }).first()).toBeVisible();
    await expect(candidates).toContainText("The candidate has not answered yet. Nothing reaches the employer until they approve.");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // The candidate approves with the certificate.
    const candidateView = await newVisitor(browser);
    const cp = candidateView.page;
    await signIn(cp, worker);
    await cp.goto("/en/submissions");
    await expect(cp.getByRole("heading", { name: "Waiting for your answer" })).toBeVisible();
    await cp.locator(`a[href="/en/submissions/${submission.id}"]`).click();
    await expect(cp).toHaveURL(`/en/submissions/${submission.id}`);
    await expect(cp.getByText(`${partner.displayName} would like to submit you`)).toBeVisible();
    await expect(cp.getByText("We placed you in Koper last year")).toBeVisible();
    await expectAccessibleAtBothWidths(cp);
    await cp.setViewportSize({ width: 1280, height: 900 });
    const approve = cp.getByRole("button", { name: "Approve and share" });
    await waitForHydration(approve);
    await cp.getByRole("checkbox", { name: "Welding certificate" }).check();
    await cp
      .getByRole("checkbox", {
        name: "I agree to share my profile and the selected documents with the employer for this submission, as the sharing notice describes",
        exact: true,
      })
      .check();
    await approve.click();
    await expect(cp.getByText("Request approved", { exact: true })).toBeVisible();
    await expect(cp.getByText("Submitted", { exact: true })).toBeVisible();
    await expect(cp.getByRole("main")).toContainText(
      "The employer can now read your profile and the documents you chose. You can withdraw at any time.",
    );
    await expect(cp.getByRole("button", { name: "Withdraw submission" })).toBeVisible();
    await expectAccessibleAtBothWidths(cp);
    await cp.setViewportSize({ width: 1280, height: 900 });

    // The partner reads the approval: the candidate's name instead of the address.
    await page.reload();
    await expect(candidates.getByRole("heading", { name: "Test Candidate" })).toBeVisible();
    await expect(candidates.getByText("Submitted", { exact: true }).first()).toBeVisible();
    await expect(candidates).toContainText("The candidate approved. The employer can read the profile and the documents the candidate chose.");
    await expect(page.getByText(worker.email)).toHaveCount(0);

    // The employer finds the candidate in the pipeline of the requirement and opens them: the stage moves to Viewed and
    // the next action is a stage change.
    const employerView = await newVisitor(browser);
    const ep = employerView.page;
    await signInAtAal2(ep, team.owner, team.ownerSecret, `/en/org/${team.slug}/requirements/${requirement}`);
    await expect(ep.getByRole("region", { name: "Submitted candidates" })).toContainText(`Submitted by ${partner.displayName}: 1`);
    await ep.goto(`/en/org/${team.slug}/applicants?requirement=${requirement}`);
    const pipeline = ep.getByRole("list", { name: "Submitted candidates" });
    await expect(pipeline.getByRole("listitem")).toHaveCount(1);
    await expect(pipeline.getByText(`Submitted by ${partner.displayName}`)).toBeVisible();
    await expect(pipeline.getByText("Submitted", { exact: true }).first()).toBeVisible();
    await expect(ep.getByText(worker.email)).toHaveCount(0);
    await expectAccessibleAtBothWidths(ep);
    await ep.setViewportSize({ width: 1280, height: 900 });
    await pipeline.getByRole("link", { name: "Test Candidate" }).click();
    await expect(ep).toHaveURL(`/en/org/${team.slug}/applicants/submissions/${submission.id}`);
    await expect(ep.getByText(`Submitted by ${partner.displayName}`).first()).toBeVisible();
    await expect(ep.getByText("Viewed", { exact: true }).first()).toBeVisible();
    await expect(ep.getByRole("button", { name: "Change stage" })).toBeVisible();
    await expect(ep.getByRole("button", { name: `Open ${certificate.title}` })).toBeVisible();
    await expectAccessibleAtBothWidths(ep);
    await employerView.context.close();
    expect(query<{ status: string }>(`select status::text from public.candidate_submissions where id = ${literal(submission.id)}`)[0].status).toBe(
      "viewed",
    );

    // Both sides read the new stage.
    await page.reload();
    await expect(candidates.getByText("Viewed by the employer", { exact: true }).first()).toBeVisible();
    await expect(candidates).toContainText("The employer has opened the candidate's profile.");
    await cp.reload();
    await expect(cp.getByText("Viewed by the employer", { exact: true }).first()).toBeVisible();
    await expect(cp.getByRole("main")).toContainText("The employer has looked at your profile. You can withdraw at any time.");
    await candidateView.context.close();
  });
});
