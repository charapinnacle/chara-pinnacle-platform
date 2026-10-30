import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { displayName, expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { partnerWithCompany, setPartnerRelease, type PartnerType } from "./support/partners";
import { addMember, enforceLimits, newTeam, newVisitor, restoreLimits, signInAtAal1, signInAtAal2, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// The comparison of responses and the decisions (V47; FR-O3 AC1, AC2, AC10, AC11 and the partner's view of AC5 to AC8;
// NFR-U3, NFR-U4, NFR-S11): an owner at aal2 compares three responses on the same rows with the withdrawn one listed
// below, at 1280 and 360 px and by keyboard; selects one partner after the statement that the platform is not a party,
// shortlists another and allows it to submit candidates, and declines the third with a note; the requirement names the
// selected partner; each partner reads only its own decision, the declined one without the employer's name; a member
// compares without decision controls; a requirement without responses, with one response and a failed read. Releases 2a
// and 2b and the plan limits are switched on for the whole database, so this file is a project of its own after the
// response pages, and its tests run one after the other. The job orders are in Monaco, which no other spec uses.

const MONACO = "MC";
const COMPARE_FUNCTION = "public.compare_responses(uuid, uuid)";
const NOT_A_PARTY_AGREEMENT = "Chara Pinnacle is not a party to your agreement or any payment with this partner";
const ROWS = [
  "Status",
  "Workers offered",
  "Earliest start",
  "Fee model",
  "Fee",
  "Relevant experience",
  "Timeline",
  "Served countries",
  "Response date",
  "Supporting documents",
  "Note to the partner",
  "Decision",
];
const requirementUrl = (slug: string, id: string) => `/en/org/${slug}/requirements/${id}`;
const responsesUrl = (slug: string, id: string) => `${requirementUrl(slug, id)}/responses`;
const compareUrl = (slug: string, id: string) => `${responsesUrl(slug, id)}/compare`;
const partnerResponseUrl = (slug: string, id: string) => `/en/org/${slug}/responses/${id}`;

type Partner = { id: string; slug: string; displayName: string; owner: TestUser };

function setJobOrderRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

// A listed partner serving Monaco with 7212 on a paid plan, with the employer-pays commitment accepted.
async function eligiblePartner(type: PartnerType = "recruitment_company"): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany(type);
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code) values
       (${literal(id)}, 'serves_market', ${literal(MONACO)}), (${literal(id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)};
     insert into billing.subscriptions (organization_id, plan_code, status, provider)
     values (${literal(id)}, ${literal(type === "staffing_company" ? "staffing_partner" : "recruitment_partner")}, 'active', 'null');
     insert into public.consents (user_id, purpose, version, action)
     select ${literal(user.id)}, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted'
     where not private.partner_commitment_current(${literal(id)});`,
  );
  return { id, slug, displayName: displayName(id), owner: user };
}

// An open job order of the team in Monaco on the marketplace without the company name, 100 welders (7212).
function seedJobOrder(team: Pick<Team, "id" | "owner">, title: string): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 100, ${literal(MONACO)}, 'Monaco', 'C', date '2027-03-01', 12,
       'full_time', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', 'job_order_marketplace', false, now(), date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 100);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(MONACO)})`,
  );
  return id;
}

type Proposal = { capacity: number; from: string; fee: "fee_per_hire" | "monthly_rate" | "on_request"; amount?: number; withdrawn?: boolean };

// A response of the partner as respond_to_invitation leaves it (without a version row: the history is not under test here), sent
// p_minutes ago so the columns keep their order.
function seedResponse(team: Pick<Team, "id">, requirement: string, partner: string, proposal: Proposal, minutes: number): string {
  const id = randomUUID();
  const withAmount = proposal.fee !== "on_request";
  execute(
    `insert into public.partner_responses (id, requirement_id, organization_id, employer_organization_id, status, capacity, available_from,
       experience_note, fee_model, fee_amount, fee_currency, created_at, updated_at, withdrawn_at)
     values (${literal(id)}, ${literal(requirement)}, ${literal(partner)}, ${literal(team.id)},
       ${literal(proposal.withdrawn ? "withdrawn" : "submitted")}, ${proposal.capacity}, ${literal(proposal.from)},
       'Welding crews placed on the Riviera for ten years', ${literal(proposal.fee)}, ${withAmount ? proposal.amount : "null"},
       ${withAmount ? "'EUR'" : "null"}, now() - interval '${minutes} minutes', now() - interval '${minutes} minutes',
       ${proposal.withdrawn ? "now()" : "null"})`,
  );
  return id;
}

function responseRow(id: string) {
  return query<{ status: string; decision_note: string | null; submissions_allowed: boolean }>(
    `select status::text, decision_note, submissions_allowed from public.partner_responses where id = ${literal(id)}`,
  )[0];
}

function queued(userId: string, kind: string): number {
  return query<{ n: number }>(`select count(*)::integer as n from public.notifications where user_id = ${literal(userId)} and kind = ${literal(kind)}`)[0].n;
}

function comparison(page: Page) {
  return page.getByRole("region", { name: "Responses compared side by side" });
}

// The cell of the row p_row in the column of the partner p_index (0 is the first response).
function cell(page: Page, row: string, index: number) {
  return comparison(page).getByRole("row").filter({ has: page.getByRole("rowheader", { name: row, exact: true }) }).getByRole("cell").nth(index);
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  execute(`delete from public.workforce_requirements where country_code = ${literal(MONACO)}`);
  setPartnerRelease(true);
  setJobOrderRelease(true);
  enforceLimits();
});
test.afterAll(() => {
  execute(`grant execute on function ${COMPARE_FUNCTION} to authenticated`);
  restoreLimits();
  setJobOrderRelease(false);
  setPartnerRelease(false);
});

test.describe("Comparing and deciding responses (FR-O3)", () => {
  test("AC1, AC2, AC10: the same rows for every response; select, shortlist with submissions, decline with a note; each partner reads its own result", async ({
    page,
    browser,
  }) => {
    test.setTimeout(360_000);
    const team = await newTeam();
    const p1 = await eligiblePartner();
    const s1 = await eligiblePartner("staffing_company");
    const p2 = await eligiblePartner();
    const p3 = await eligiblePartner();
    const id = seedJobOrder(team, "Monaco harbour welders");
    const r1 = seedResponse(team, id, p1.id, { capacity: 80, from: "2027-01-10", fee: "fee_per_hire", amount: 1500 }, 40);
    const rs = seedResponse(team, id, s1.id, { capacity: 100, from: "2027-02-01", fee: "monthly_rate", amount: 3200 }, 30);
    const r2 = seedResponse(team, id, p2.id, { capacity: 50, from: "2027-02-15", fee: "on_request" }, 20);
    seedResponse(team, id, p3.id, { capacity: 10, from: "2027-02-15", fee: "on_request", withdrawn: true }, 10);

    await signInAtAal2(page, team.owner, team.ownerSecret, responsesUrl(team.slug, id));
    await page.getByRole("link", { name: "Compare responses" }).click();
    await expect(page).toHaveURL(compareUrl(team.slug, id));
    await expect(page.getByRole("heading", { name: "Compare responses", level: 1 })).toBeVisible();

    // AC1: one column per response that is not withdrawn, headed by the partner with a link to its profile; the same
    // rows in the same order; On request; the withdrawn one below the table; no licence detail.
    const headers = comparison(page).getByRole("columnheader");
    await expect(headers).toHaveCount(3);
    await expect(headers.nth(0)).toContainText(p1.displayName);
    await expect(headers.nth(1)).toContainText(s1.displayName);
    await expect(headers.nth(2)).toContainText(p2.displayName);
    await expect(headers.nth(0).getByRole("link", { name: p1.displayName })).toHaveAttribute("href", `/en/partners/${p1.slug}?for=${team.slug}`);
    await expect(comparison(page).getByRole("rowheader")).toHaveText(ROWS);
    await expect(cell(page, "Workers offered", 0)).toHaveText("80 workers");
    await expect(cell(page, "Fee", 0)).toHaveText("EUR 1,500.00 per hire");
    await expect(cell(page, "Fee", 1)).toHaveText("EUR 3,200.00 per month");
    await expect(cell(page, "Fee", 2)).toHaveText("On request");
    await expect(cell(page, "Earliest start", 1)).toHaveText("1 February 2027");
    await expect(cell(page, "Served countries", 0)).toContainText("Monaco");
    await expect(comparison(page).getByText(p3.displayName)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Withdrawn" })).toContainText(p3.displayName);
    await expect(comparison(page).getByText(/licen[cs]e/i)).toHaveCount(0);

    // AC2: the table scrolls in its own container at 360 px, the page never sideways; named decision controls; axe.
    for (const partner of [p1, s1, p2]) {
      for (const verb of ["Shortlist", "Select", "Decline"]) {
        await expect(page.getByRole("button", { name: `${verb} ${partner.displayName}`, exact: true })).toBeVisible();
      }
    }
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await comparison(page).evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });

    // AC10: Select opens the statement that the platform is not a party and that the partner can then submit; by keyboard.
    const select = page.getByRole("button", { name: `Select ${s1.displayName}`, exact: true });
    await waitForHydration(select);
    await select.focus();
    await page.keyboard.press("Enter");
    const selectDialog = page.getByRole("dialog", { name: `Select ${s1.displayName}?` });
    await expect(selectDialog).toContainText(NOT_A_PARTY_AGREEMENT);
    await expect(selectDialog).toContainText("can then submit candidates for this requirement");
    await expectNoAxeViolations(page);
    await selectDialog.getByRole("button", { name: "Select", exact: true }).click();
    await expect(page.getByText("Partner selected", { exact: true })).toBeVisible();
    await expect(headers.nth(1)).toBeFocused();
    await expect(cell(page, "Status", 1)).toContainText("Selected");
    await expect(cell(page, "Decision", 1)).toHaveText("Decided");

    // Shortlist P1 and allow it to submit candidates (AC8).
    await page.getByRole("button", { name: `Shortlist ${p1.displayName}`, exact: true }).click();
    const shortlistDialog = page.getByRole("dialog", { name: `Shortlist ${p1.displayName}?` });
    await shortlistDialog.getByRole("button", { name: "Shortlist", exact: true }).click();
    await expect(page.getByText("Response shortlisted", { exact: true })).toBeVisible();
    await expect(cell(page, "Status", 0)).toContainText("Shortlisted");
    await expect(page.getByRole("button", { name: `Shortlist ${p1.displayName}`, exact: true })).toHaveCount(0);
    const allow = page.getByRole("button", { name: `Allow candidate submissions from ${p1.displayName}` });
    await waitForHydration(allow);
    await allow.click();
    await expect(page.getByText("Candidate submissions allowed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Close candidate submissions for ${p1.displayName}` })).toBeVisible();

    // AC10, AC5: Decline asks for the optional note the partner will see, up to 1,000 characters.
    await page.getByRole("button", { name: `Decline ${p2.displayName}`, exact: true }).click();
    const declineDialog = page.getByRole("dialog", { name: `Decline the response of ${p2.displayName}?` });
    const note = declineDialog.getByLabel("Note to the partner");
    await expect(declineDialog).toContainText("The partner will see this note");
    await note.fill("x".repeat(1001));
    await declineDialog.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(declineDialog.getByText("The note must have 1,000 characters or fewer.").first()).toBeVisible();
    expect(responseRow(r2).status).toBe("submitted");
    await note.fill("Fee above budget");
    await expectNoAxeViolations(page);
    await declineDialog.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(page.getByText("Response declined", { exact: true })).toBeVisible();
    await expect(headers.nth(2)).toBeFocused();
    await expect(cell(page, "Status", 2)).toContainText("Declined");
    await expect(cell(page, "Note to the partner", 2)).toHaveText("Fee above budget");
    await expectAccessibleAtBothWidths(page);

    // A selected and a declined response offer no decision, on the comparison and on their own pages.
    for (const partner of [s1, p2]) {
      for (const verb of ["Shortlist", "Select", "Decline"]) {
        await expect(page.getByRole("button", { name: `${verb} ${partner.displayName}`, exact: true })).toHaveCount(0);
      }
    }
    await expect(cell(page, "Decision", 2)).toHaveText("Decided");
    for (const decided of [rs, r2]) {
      await page.goto(`${responsesUrl(team.slug, id)}/${decided}`);
      await expect(page.getByRole("heading", { name: "Status", level: 2 })).toBeVisible();
      await expect(page.getByRole("button", { name: /^(Shortlist|Select|Decline) / })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /candidate submissions/ })).toHaveCount(0);
    }

    expect(responseRow(rs)).toEqual({ status: "selected", decision_note: null, submissions_allowed: true });
    expect(responseRow(r1)).toEqual({ status: "shortlisted", decision_note: null, submissions_allowed: true });
    expect(responseRow(r2)).toEqual({ status: "declined", decision_note: "Fee above budget", submissions_allowed: false });
    expect(queued(s1.owner.id, "response_decided")).toBe(1);
    expect(queued(p1.owner.id, "response_decided")).toBe(2);
    expect(queued(p2.owner.id, "response_decided")).toBe(1);

    // FR-O3 step Record: the requirement names the selected partner.
    await page.goto(requirementUrl(team.slug, id));
    await expect(page.getByText(`Selected partner: ${s1.displayName}`)).toBeVisible();

    // AC6, AC7, AC8: the selected partner reads its decision and the employer's name; the declined one its note only.
    const selected = await newVisitor(browser);
    await signInAtAal1(selected.page, s1.owner, partnerResponseUrl(s1.slug, rs));
    await expect(selected.page.getByText("The employer selected your company for this requirement")).toBeVisible();
    await expect(selected.page.getByText("The employer allows your company to submit candidates for this requirement.")).toBeVisible();
    await expect(selected.page.getByText(displayName(team.id)).first()).toBeVisible();
    await expect(selected.page.getByRole("heading", { name: "Monaco harbour welders", level: 1 })).toBeVisible();
    await expectAccessibleAtBothWidths(selected.page);
    await selected.context.close();

    const declined = await newVisitor(browser);
    await signInAtAal1(declined.page, p2.owner, partnerResponseUrl(p2.slug, r2));
    await expect(declined.page.getByText("Declined", { exact: true })).toBeVisible();
    await expect(declined.page.getByText("Note from the employer: Fee above budget")).toBeVisible();
    await expect(declined.page.getByText("Company not named").first()).toBeVisible();
    for (const hidden of [displayName(team.id), s1.displayName, p1.displayName, "Monaco harbour welders"]) {
      await expect(declined.page.getByText(hidden)).toHaveCount(0);
    }
    await expect(declined.page.getByRole("link", { name: "Change response" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(declined.page);
    await declined.context.close();
  });

  test("a member compares without decision controls; a decided response offers none on its own page", async ({ page }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const p1 = await eligiblePartner();
    const id = seedJobOrder(team, "Monaco quay riggers");
    const r1 = seedResponse(team, id, p1.id, { capacity: 20, from: "2027-01-20", fee: "on_request" }, 5);
    execute(
      `update public.partner_responses set status = 'selected', decided_at = now(), decided_by = ${literal(team.owner.id)},
         submissions_allowed = true, decision_note = 'Welcome aboard'
       where id = ${literal(r1)}`,
    );
    const { user } = await addMember(team, "member");
    await signInAtAal1(page, user, compareUrl(team.slug, id));
    await expect(page.getByText("The owner and admins of your company shortlist, select and decline responses.")).toBeVisible();
    await expect(comparison(page).getByRole("rowheader")).toHaveText(ROWS.slice(0, -1));
    await expect(page.getByRole("button", { name: new RegExp(`(Shortlist|Select|Decline) ${p1.displayName}`) })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.goto(`${responsesUrl(team.slug, id)}/${r1}`);
    await expect(page.getByText("Your note to the partner: Welcome aboard")).toBeVisible();
    await expect(page.getByText("The partner can submit candidates.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Shortlist|Select|Decline) / })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
  });

  test("AC11: no responses, one response in one column, and a failed read with a toast and a retry", async ({ page }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const p1 = await eligiblePartner();
    const empty = seedJobOrder(team, "Monaco empty welders");
    await signInAtAal2(page, team.owner, team.ownerSecret, responsesUrl(team.slug, empty));
    await expect(page.getByText("No responses yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Invite partners" })).toHaveAttribute("href", `${requirementUrl(team.slug, empty)}/partners`);
    await expect(page.getByRole("link", { name: "See the job order status" })).toHaveAttribute("href", requirementUrl(team.slug, empty));
    await expect(page.getByRole("link", { name: "Compare responses" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.goto(compareUrl(team.slug, empty));
    await expect(page.getByText("No responses yet")).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    const one = seedJobOrder(team, "Monaco single welders");
    seedResponse(team, one, p1.id, { capacity: 30, from: "2027-01-20", fee: "fee_per_hire", amount: 900 }, 5);
    await page.goto(compareUrl(team.slug, one));
    await expect(comparison(page).getByRole("columnheader")).toHaveCount(1);
    await expect(page.getByRole("button", { name: `Select ${p1.displayName}`, exact: true })).toBeVisible();

    execute(`revoke execute on function ${COMPARE_FUNCTION} from authenticated`);
    try {
      await page.reload();
      await expect(page.getByText("The responses could not be compared").first()).toBeVisible();
      await expectNoAxeViolations(page);
    } finally {
      execute(`grant execute on function ${COMPARE_FUNCTION} to authenticated`);
    }
    const retry = page.getByRole("button", { name: "Try again" });
    await waitForHydration(retry);
    await retry.click();
    await expect(comparison(page).getByRole("columnheader")).toHaveCount(1);
  });
});
