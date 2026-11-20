import { randomUUID } from "node:crypto";
import type { Page, Response as PageResponse } from "@playwright/test";
import { dataApiAs } from "./support/accounts";
import { displayName } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { waitForMessage } from "./support/mailpit";
import { runNotify } from "./support/notify";
import { uniqueToken } from "./support/organizations";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { newTeam, newVisitor, signInAtAal1, signInAtAal2, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// NFR-S11 (V79): an employer that keeps its name off a job order is not identifiable by a partner it did not invite or
// select. Nothing that reaches the browser of such a partner (the HTML, the React Server Component payloads and every
// other text or JSON response, the title and the meta tags) nor what the Data API answers it (list_job_orders,
// get_job_order, search_employers, the tables) nor its notification (the bell, the queued payload and the email) holds
// the employer's display name, legal name, slug, organisation id, website, the owner's address or the employer's own
// title of the job order, on the board, the job order page, the response form, its response, Find Employers, its
// dashboard and the public pages; a partner on no plan neither. The organisations have no logo field (DATA_MODEL.md), so
// there is no logo to leak. As a control, the partner the employer invited reads the name on the same page. Releases 2a
// and 2b are switched on for the whole database, so this file is a project of its own after the journeys of release 2b.
// The job order is in Lithuania, which no other spec uses.

const LITHUANIA = "LT";
const NEUTRAL_TITLE = "Lithuania, 30 Welders and flame cutters";

type Partner = { id: string; slug: string; owner: TestUser };

function setJobOrderRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

// A listed recruitment company serving Lithuania with 7212 with the employer-pays commitment accepted, on the plan given
// (Professional opens Find Employers).
async function listedPartner(plan: string | null): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code) values (${literal(id)}, 'serves_market', ${literal(LITHUANIA)});
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)};
     insert into public.consents (user_id, purpose, version, action)
     select ${literal(user.id)}, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted'
     where not private.partner_commitment_current(${literal(id)});
     ${plan ? `insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(id)}, ${literal(plan)}, 'active', 'null');` : ""}`,
  );
  return { id, slug, owner: user };
}

// Every text the browser receives while p_visit runs: the bodies of the document, the RSC payloads and the JSON and
// text responses (the build's static chunks hold no data and are left out), their addresses, and then the page's HTML
// and title.
async function received(page: Page, visit: () => Promise<void>): Promise<string> {
  const bodies: Promise<string>[] = [];
  const listener = (response: PageResponse) => {
    const type = response.headers()["content-type"] ?? "";
    if (response.url().includes("/_next/static/") || !/text|json|x-component/.test(type)) return;
    bodies.push(response.text().then((body) => `${response.url()}\n${JSON.stringify(response.headers())}\n${body}`, () => response.url()));
  };
  page.on("response", listener);
  try {
    await visit();
  } finally {
    page.off("response", listener);
  }
  return [...(await Promise.all(bodies)), page.url(), await page.title(), await page.content()].join("\n");
}

function expectNoneOf(text: string, secrets: string[], where: string): void {
  for (const secret of secrets) expect(text.includes(secret), `${where}: "${secret}" reached the partner`).toBe(false);
}

async function rpc(user: TestUser, name: string, body: Record<string, unknown>): Promise<string> {
  const response = await dataApiAs(user, `rpc/${name}`, { method: "POST", body });
  expect(response.status, name).toBe(200);
  return response.text();
}

let team: Team;
let jobOrder: string;
let ownTitle: string;
let secrets: string[];

test.describe("job orders without the employer's name (NFR-S11)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async () => {
    execute(`delete from public.workforce_requirements where country_code = ${literal(LITHUANIA)}`);
    setPartnerRelease(true);
    setJobOrderRelease(true);
    team = await newTeam();
    const website = `https://anon-${uniqueToken()}.example`;
    execute(`update public.organizations set public_page_enabled = true, website = ${literal(website)} where id = ${literal(team.id)}`);
    const [legal] = query<{ legal_name: string }>(`select legal_name from public.organizations where id = ${literal(team.id)}`);
    ownTitle = `Klaipeda foundry welders ${uniqueToken()}`;
    secrets = [displayName(team.id), legal.legal_name, team.slug, team.id, website, new URL(website).host, team.owner.email, ownTitle];
    jobOrder = randomUUID();
    execute(
      `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
         start_date, duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, skills,
         recruitment_preference, partner_need, created_by, status)
       values (${literal(jobOrder)}, ${literal(team.id)}, ${literal(ownTitle)}, 30, ${literal(LITHUANIA)}, 'Vilnius', 'C', current_date + 90, 12,
         'full_time', 1800, 2200, 'EUR', 'month', 'MIG welding of steel castings', 'international', 'recruitment', ${literal(team.owner.id)}, 'draft');
       insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(jobOrder)}, '7212', 30);
       insert into public.requirement_countries (requirement_id, country_code) values (${literal(jobOrder)}, ${literal(LITHUANIA)})`,
    );
  });
  test.afterAll(() => {
    setJobOrderRelease(false);
    setPartnerRelease(false);
  });

  test("an uninvited partner's pages, network responses, Data API answers and notification hold nothing of the employer", async ({
    page,
    browser,
  }) => {
    test.setTimeout(420_000);
    const uninvited = await listedPartner("recruitment_professional");

    // The partner switches on the new job order alert, then the employer publishes the job order without its name.
    await signInAtAal1(page, uninvited.owner, "/en/settings/notifications");
    const section = page.locator("#email-notifications");
    const alert = section.getByRole("switch", { name: "New job orders that fit" });
    await waitForHydration(alert);
    await alert.click();
    await section.getByRole("button", { name: "Save email choices" }).click();
    await expect(page.getByText("Email choices saved", { exact: true })).toBeVisible();

    const owner = await newVisitor(browser);
    await signInAtAal2(owner.page, team.owner, team.ownerSecret, `/en/org/${team.slug}/requirements/${jobOrder}`);
    const publishButton = owner.page.getByRole("button", { name: "Publish", exact: true });
    await waitForHydration(publishButton);
    await publishButton.click();
    const publish = owner.page.getByRole("dialog", { name: "Publish this requirement" });
    await publish.getByRole("radio", { name: "Job order marketplace", exact: true }).check();
    await expect(publish.getByRole("checkbox", { name: "Show our company name" })).not.toBeChecked();
    await publish.getByRole("button", { name: "Publish requirement" }).click();
    await expect(owner.page.getByText("The requirement is published", { exact: true })).toBeVisible();
    await owner.context.close();

    // The board, filtered and not, and the job order page.
    const board = await received(page, async () => {
      await page.goto(`/en/org/${uninvited.slug}/job-orders?destination=${LITHUANIA}`);
      await expect(page.getByRole("heading", { name: NEUTRAL_TITLE, level: 2 })).toBeVisible();
      await expect(page.getByText(/Company not named/).first()).toBeVisible();
    });
    expectNoneOf(board, secrets, "the board");
    const unfiltered = await received(page, async () => {
      await page.goto(`/en/org/${uninvited.slug}/job-orders`);
      await expect(page.getByRole("heading", { name: "Job orders", level: 1 })).toBeVisible();
    });
    expectNoneOf(unfiltered, secrets, "the board without a filter");

    const detail = await received(page, async () => {
      await page.goto(`/en/org/${uninvited.slug}/job-orders/${jobOrder}`);
      await expect(page.getByRole("heading", { name: NEUTRAL_TITLE, level: 1 })).toBeVisible();
      await expect(page.getByText("Company not named", { exact: true })).toBeVisible();
      await expect(page.getByRole("main")).toContainText("Vilnius, Lithuania");
    });
    expectNoneOf(detail, secrets, "the job order page");
    // The skills are the employer's own words, left out where the name is not shown.
    expectNoneOf(detail, ["MIG welding of steel castings"], "the job order page");
    expect(await page.title()).toMatch(/^Job order/);
    for (const meta of await page.locator("head meta").evaluateAll((tags) => tags.map((tag) => tag.outerHTML))) {
      expectNoneOf(meta, secrets, "the meta tags");
    }

    const respond = await received(page, async () => {
      await page.goto(`/en/org/${uninvited.slug}/job-orders/${jobOrder}/respond`);
      await expect(page.getByRole("heading", { name: "Respond to this job order", level: 1 })).toBeVisible();
    });
    expectNoneOf(respond, secrets, "the response form");

    // Its own response to the job order, in its list and on its page.
    const response = randomUUID();
    execute(
      `insert into public.partner_responses (id, requirement_id, organization_id, employer_organization_id, capacity, available_from,
         experience_note, fee_model)
       values (${literal(response)}, ${literal(jobOrder)}, ${literal(uninvited.id)}, ${literal(team.id)}, 20, current_date + 30,
         'Twenty years of welding crews in the Baltics', 'on_request')`,
    );
    const responses = await received(page, async () => {
      await page.goto(`/en/org/${uninvited.slug}/responses`);
      await expect(page.getByRole("list", { name: "Responses" }).getByRole("listitem").first()).toContainText("Company not named");
    });
    expectNoneOf(responses, secrets, "the responses list");
    const ownResponse = await received(page, async () => {
      await page.goto(`/en/org/${uninvited.slug}/responses/${response}`);
      await expect(page.getByRole("region", { name: "Status" }).getByText("Sent", { exact: true })).toBeVisible();
    });
    expectNoneOf(ownResponse, secrets, "the response page");

    // Find Employers: the job order is a row of its own, never next to its employer.
    const findEmployers = await received(page, async () => {
      await page.goto(`/en/org/${uninvited.slug}/find-employers?destination=${LITHUANIA}`);
      await expect(page.getByRole("heading", { name: "Find employers", level: 1 })).toBeVisible();
      await expect(page.getByText("Company not named").first()).toBeVisible();
    });
    expectNoneOf(findEmployers, secrets, "Find Employers");

    const dashboard = await received(page, async () => {
      await page.goto(`/en/dashboard/recruitment?org=${uninvited.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
    expectNoneOf(dashboard, secrets, "the partner dashboard");

    // The notification: queued payload, bell and email.
    const [match] = query<{ payload: string }>(
      `select payload::text from public.notifications where user_id = ${literal(uninvited.owner.id)} and kind = 'job_order_match'`,
    );
    expect(match, "the new job order alert is queued").toBeDefined();
    expectNoneOf(match.payload, secrets, "the queued notification");
    const bell = await received(page, async () => {
      await page.goto("/en/notifications");
      await expect(page.getByRole("link", { name: `New job order: ${NEUTRAL_TITLE}` })).toBeVisible();
    });
    expectNoneOf(bell, secrets, "the notifications page");
    await runNotify();
    const email = await waitForMessage(uninvited.owner.email, { subject: `New job order: ${NEUTRAL_TITLE}` });
    expectNoneOf(`${email.Subject}\n${email.Text}\n${email.HTML}`, secrets, "the email");

    // What the Data API answers this partner.
    expectNoneOf(await rpc(uninvited.owner, "list_job_orders", { p_org: uninvited.id, p_destination: LITHUANIA }), secrets, "list_job_orders");
    expectNoneOf(await rpc(uninvited.owner, "get_job_order", { p_org: uninvited.id, p_requirement: jobOrder }), secrets, "get_job_order");
    expectNoneOf(await rpc(uninvited.owner, "search_employers", { p_org: uninvited.id, p_destination: LITHUANIA }), secrets, "search_employers");
    for (const path of [
      `workforce_requirements?id=eq.${jobOrder}`,
      `requirement_countries?requirement_id=eq.${jobOrder}`,
      `requirement_occupations?requirement_id=eq.${jobOrder}`,
      `requirement_invitations?requirement_id=eq.${jobOrder}`,
    ]) {
      // Nothing comes back: either no row, or the table is not granted to the role at all.
      const answer = await dataApiAs(uninvited.owner, path);
      const body: unknown = await answer.json();
      if (answer.ok) expect(body, path).toEqual([]);
      else expect(body, path).toMatchObject({ code: "42501" });
    }
    // Its own response row is readable without the employer's organisation, whose column is not granted.
    const ownRow = await dataApiAs(uninvited.owner, `partner_responses?id=eq.${response}&select=id,status,capacity`);
    expect(await ownRow.json()).toEqual([{ id: response, status: "submitted", capacity: 20 }]);
    expect((await dataApiAs(uninvited.owner, `partner_responses?id=eq.${response}&select=employer_organization_id`)).ok).toBe(false);
  });

  test("a partner on no plan reads the job order reduced, without the employer, and so does a visitor on the public pages", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const free = await listedPartner(null);
    await signInAtAal1(page, free.owner, `/en/org/${free.slug}/job-orders?destination=${LITHUANIA}`);
    const board = await received(page, async () => {
      await page.reload();
      await expect(page.getByRole("heading", { name: NEUTRAL_TITLE, level: 2 })).toBeVisible();
    });
    expectNoneOf(board, secrets, "the board of a partner on no plan");
    const detail = await received(page, async () => {
      await page.goto(`/en/org/${free.slug}/job-orders/${jobOrder}`);
      await expect(page.getByRole("heading", { name: "Only the title is shown to your company" })).toBeVisible();
    });
    expectNoneOf(detail, [...secrets, "Vilnius"], "the job order page of a partner on no plan");
    expectNoneOf(await rpc(free.owner, "get_job_order", { p_org: free.id, p_requirement: jobOrder }), secrets, "get_job_order on no plan");

    const visitor = await newVisitor(browser);
    for (const path of ["/en/job-orders", "/en/companies", `/en/companies/${team.slug}`]) {
      const text = await received(visitor.page, async () => {
        await visitor.page.goto(path);
        await expect(visitor.page.getByRole("heading", { level: 1 })).toBeVisible();
      });
      // The company page names its own company; it must not tie the anonymous job order to it.
      expectNoneOf(text, path.startsWith("/en/companies/") ? [jobOrder, ownTitle, NEUTRAL_TITLE] : secrets, path);
    }
    await visitor.context.close();
  });

  test("control: the partner the employer invited reads the employer's name on the same page", async ({ page }) => {
    test.setTimeout(180_000);
    const invited = await listedPartner("recruitment_partner");
    execute(
      `insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source, status)
       values (${literal(jobOrder)}, ${literal(invited.id)}, ${literal(team.id)}, 'directory', 'invited');
       insert into private.requirement_reveals (requirement_id, organization_id, cause)
       values (${literal(jobOrder)}, ${literal(invited.id)}, 'invitation')`,
    );
    await signInAtAal1(page, invited.owner, `/en/org/${invited.slug}/job-orders/${jobOrder}`);
    await expect(page.getByRole("main")).toContainText(displayName(team.id));
    expect(await rpc(invited.owner, "get_job_order", { p_org: invited.id, p_requirement: jobOrder })).toContain(displayName(team.id));
  });
});
