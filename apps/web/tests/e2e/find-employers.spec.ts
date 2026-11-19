import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { displayName, expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal } from "./support/db";
import { logIn } from "./support/login-page";
import { waitForHydration } from "./support/hydration";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { newTeam, newVisitor, signInAtAal1, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// Find Employers (FR-L3 AC7 to AC9, AC11, NFR-S11) and the public Find companies page (FR-L5 AC3, AC10). Releases 2a
// and 2b are switched on for the whole database, so this file is a project of its own after the submission pipeline.
// Other specs leave open marketplace requirements behind, so the job orders made here are in Iceland, which only the job
// order spec (which runs earlier and clears them) uses, and the results are filtered on it.

const ICELAND = "IS";
const searchUrl = (slug: string, query = `destination=${ICELAND}`) => `/en/org/${slug}/find-employers${query ? `?${query}` : ""}`;
const FUNCTION = "public.search_employers(uuid, text, text, text, integer, uuid, integer)";

function setJobOrderRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

type Partner = { id: string; slug: string; owner: TestUser };

// A listed recruitment company serving Iceland and listing welders, on p_plan (the free plan code when null).
async function listedPartner(plan: string | null): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code) values (${literal(id)}, 'serves_market', ${literal(ICELAND)});
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)};
     ${plan ? `insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(id)}, ${literal(plan)}, 'active', 'null');` : ""}`,
  );
  return { id, slug, owner: user };
}

// An open marketplace job order of the team in Iceland, as publish_requirement leaves it, published p_minutes from now.
function seedJobOrder(team: Pick<Team, "id" | "owner">, { title, show, minutes }: { title: string; show: boolean; minutes: number }): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 100, ${literal(ICELAND)}, 'Reykjavik', 'C', date '2027-03-01', 12,
       'full_time', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', 'job_order_marketplace', ${show},
       now() + interval '${minutes} minutes', date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 100);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(ICELAND)})`,
  );
  return id;
}

function results(page: Page) {
  return page.getByRole("list", { name: "Employers and job orders" }).locator(":scope > li");
}

function result(page: Page, heading: string) {
  return results(page).filter({ has: page.getByRole("heading", { name: heading, level: 2 }) });
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  execute(`delete from public.workforce_requirements where country_code = ${literal(ICELAND)}`);
  setPartnerRelease(true);
  setJobOrderRelease(true);
});
test.afterAll(() => {
  execute(`grant execute on function ${FUNCTION} to authenticated`);
  execute(`delete from public.workforce_requirements where country_code = ${literal(ICELAND)}`);
  setJobOrderRelease(false);
  setPartnerRelease(false);
});

test.describe("Find Employers (FR-L3)", () => {
  let acme: Team;
  let beta: Team;
  let gamma: Team;
  let anonymous: string;

  test.beforeAll(async () => {
    [acme, beta, gamma] = [await newTeam(), await newTeam(), await newTeam()];
    execute(`update public.organizations set public_page_enabled = true where id = ${literal(acme.id)}`);
    seedJobOrder(acme, { title: "Acme named welders", show: true, minutes: 30 });
    seedJobOrder(beta, { title: "Beta named welders", show: true, minutes: 20 });
    anonymous = seedJobOrder(gamma, { title: "Gamma secret welders", show: false, minutes: 10 });
  });

  test("AC7, NFR-S11: a Professional partner reads companies and a job order without its employer", async ({ page }) => {
    test.setTimeout(240_000);
    const partner = await listedPartner("recruitment_professional");
    // The dashboard link is held by tests/unit/partner-dashboard.test.tsx; an owner at aal1 opens the page itself.
    await signInAtAal1(page, partner.owner, searchUrl(partner.slug));
    await expect(page.getByRole("heading", { name: "Find employers", level: 1 })).toBeVisible();

    const acmeName = displayName(acme.id);
    const acmeCard = result(page, acmeName);
    await expect(acmeCard.getByRole("link", { name: acmeName })).toHaveAttribute("href", `/en/companies/${acme.slug}`);
    await expect(acmeCard).toContainText("0 public vacancies");
    await expect(acmeCard.getByRole("link", { name: "Acme named welders" })).toBeVisible();
    await expect(acmeCard.getByRole("button", { name: `Follow: ${acmeName}` })).toBeVisible();

    const betaName = displayName(beta.id);
    const betaCard = result(page, betaName);
    await expect(betaCard.getByRole("heading", { name: betaName, level: 2 }).getByRole("link")).toHaveCount(0);
    await expect(betaCard.getByRole("link", { name: "Beta named welders" })).toBeVisible();

    const gammaCard = result(page, "Company not named");
    await expect(gammaCard).toContainText("Manufacturing, Iceland, 100 Welders and flame cutters");
    await expect(gammaCard.getByRole("link", { name: /^Open job order/ })).toHaveAttribute("href", `/en/org/${partner.slug}/job-orders/${anonymous}`);
    await expect(gammaCard.getByRole("button", { name: /Follow/ })).toHaveCount(0);

    // Newest activity first.
    await expect(results(page).getByRole("heading", { level: 2 })).toHaveText([acmeName, betaName, "Company not named"]);
    const html = await page.content();
    for (const hidden of [displayName(gamma.id), gamma.id, gamma.slug, "Gamma secret welders"]) expect(html).not.toContain(hidden);
    for (const label of ["Destination country", "Industry", "Occupation", "Workers needed, at least"]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("AC9: a Professional partner saves a search; a Basic partner sees the advanced filters locked and no Save search", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const pro = await listedPartner("recruitment_professional");
    await signInAtAal1(page, pro.owner, searchUrl(pro.slug, `destination=${ICELAND}&occupation=7212`));
    const save = page.getByRole("button", { name: "Save search" });
    await waitForHydration(save);
    await save.click();
    await expect(page.getByText("Search saved", { exact: true })).toBeVisible();
    const saved = page.getByRole("region", { name: "Saved searches" });
    await expect(saved.getByRole("link", { name: "Iceland · 7212 Welders and flame cutters" })).toHaveAttribute(
      "href",
      searchUrl(pro.slug, `destination=${ICELAND}&occupation=7212`),
    );
    await saved.getByRole("button", { name: "Delete saved search: Iceland · 7212 Welders and flame cutters" }).click();
    await expect(saved.getByText("No saved searches yet.")).toBeVisible();

    const basic = await listedPartner("recruitment_partner");
    const other = await newVisitor(browser);
    await signInAtAal1(other.page, basic.owner, searchUrl(basic.slug));
    for (const label of ["Occupation", "Workers needed, at least"]) {
      await expect(other.page.getByRole("group", { name: label })).toContainText("Available on Professional.");
    }
    await expect(other.page.getByRole("group", { name: "Occupation" }).getByRole("link", { name: "See plans" })).toHaveAttribute(
      "href",
      `/en/org/${basic.slug}/billing`,
    );
    await expect(other.page.getByRole("button", { name: "Save search" })).toHaveCount(0);
    await expect(other.page.getByRole("region", { name: "Saved searches" })).toHaveCount(0);
    await other.page.goto(searchUrl(basic.slug, "occupation=7212"));
    await expect(other.page.getByText("Occupation and size filters are available on Professional.")).toBeVisible();
    await other.context.close();
  });

  test("AC11: no result, a failure with a retry, and a company that is not listed", async ({ page }) => {
    test.setTimeout(240_000);
    const partner = await listedPartner("recruitment_partner");
    await signInAtAal1(page, partner.owner, searchUrl(partner.slug, "destination=GL"));
    await expect(page.getByRole("heading", { name: "No employers or job orders match your filters" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", searchUrl(partner.slug, ""));
    await expectNoAxeViolations(page);

    execute(`revoke execute on function ${FUNCTION} from authenticated`);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "The employers could not be loaded" })).toBeVisible();
      await expectNoAxeViolations(page);
    } finally {
      execute(`grant execute on function ${FUNCTION} to authenticated`);
    }
    const retry = page.getByRole("button", { name: "Try again" });
    await waitForHydration(retry);
    await retry.click();
    await expect(page.getByRole("heading", { name: "No employers or job orders match your filters" })).toBeVisible();

    execute(`update public.organizations set listed_at = null, review_status = 'pending_review' where id = ${literal(partner.id)}`);
    await page.reload();
    await expect(page.getByText("Find Employers is for companies listed in the partner directories. Yours is not listed yet.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Employers and job orders" })).toHaveCount(0);
  });
});

test.describe("Find companies (FR-L3 AC8, FR-L5)", () => {
  test("a visitor, an employer and a free partner read the explanation and see no employer; a paid partner is taken to the search", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await page.goto("/en/companies");
    await expect(page.getByRole("heading", { name: "Find companies", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up as a recruitment or staffing company" })).toHaveAttribute("href", "/en/signup?kind=company");
    await expect(page.getByRole("list", { name: "Employers and job orders" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const team = await newTeam();
    const employer = await newVisitor(browser);
    await signInAtAal1(employer.page, team.owner, "/en/companies");
    await expect(employer.page.getByText("Find Employers is for recruitment and staffing companies listed in the partner directories.")).toBeVisible();
    await employer.context.close();

    const free = await listedPartner(null);
    const freePage = await newVisitor(browser);
    await logIn(freePage.page, free.owner, "/en/companies");
    await expect(freePage.page).toHaveURL(searchUrl(free.slug, ""));
    await expect(freePage.page.getByText("Find Employers is part of the paid partner plans.", { exact: false })).toBeVisible();
    await expect(freePage.page.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", `/en/org/${free.slug}/billing`);
    await expect(freePage.page.getByRole("list", { name: "Employers and job orders" })).toHaveCount(0);
    await freePage.context.close();

    const basic = await listedPartner("recruitment_partner");
    const basicPage = await newVisitor(browser);
    await logIn(basicPage.page, basic.owner, "/en/companies");
    await expect(basicPage.page).toHaveURL(searchUrl(basic.slug, ""));
    await expect(basicPage.page.getByRole("search", { name: "Filter employers" })).toBeVisible();
    await basicPage.context.close();
  });
});
