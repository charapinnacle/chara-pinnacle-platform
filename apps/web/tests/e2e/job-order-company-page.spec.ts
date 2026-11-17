import { randomUUID } from "node:crypto";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal } from "./support/db";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { newTeam, signInAtAal1, type Team } from "./support/team";
import { expect, test } from "./support/test";

// Named job orders on the company page (V54, FR-K5 AC3, AC4; FR-L4 AC7; decision 3.1; NFR-S11). Releases 2a and 2b are
// switched on for the whole database, so this file is a project of its own after Find Employers. The job orders belong to
// an employer of this file and are removed afterwards.

const LIECHTENSTEIN = "LI";
const companyUrl = (slug: string) => `/en/companies/${slug}`;

function setJobOrderRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

// An open marketplace job order of the team, as publish_requirement leaves it.
function seedJobOrder(team: Pick<Team, "id" | "owner">, title: string, show: boolean, visibility = "job_order_marketplace"): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 40, ${literal(LIECHTENSTEIN)}, 'Vaduz', 'C', date '2027-03-01', 12,
       'full_time', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', ${literal(visibility)}, ${show},
       now() - interval '1 hour', date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 40);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(LIECHTENSTEIN)})`,
  );
  return id;
}

test.describe("Named job orders on the company page (V54)", () => {
  test.describe.configure({ mode: "serial" });
  let acme: Team;
  let named: string;
  let anonymous: string;

  test.beforeAll(async () => {
    setPartnerRelease(true);
    setJobOrderRelease(true);
    acme = await newTeam();
    execute(`update public.organizations set public_page_enabled = true where id = ${literal(acme.id)}`);
    named = seedJobOrder(acme, "Acme welders for Vaduz", true);
    anonymous = seedJobOrder(acme, "Acme secret welders", false);
    seedJobOrder(acme, "Acme private welders", false, "private");
  });
  test.afterAll(() => {
    execute(`delete from public.workforce_requirements where organization_id = ${literal(acme.id)}`);
    setJobOrderRelease(false);
    setPartnerRelease(false);
  });

  test("FR-K5 AC3, AC4: a visitor reads the named job order without a link; the anonymous and private ones are absent", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(companyUrl(acme.slug));
    const section = page.getByRole("region", { name: "Job orders" });
    await expect(section.getByRole("heading", { name: "Acme welders for Vaduz", level: 3 })).toBeVisible();
    await expect(section).toContainText("Liechtenstein · 40 workers · Published");
    await expect(section.getByRole("link")).toHaveCount(0);
    const html = await page.content();
    for (const hidden of [anonymous, named, "Acme secret welders", "Acme private welders"]) expect(html).not.toContain(hidden);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("FR-L4 AC7: a listed partner's member opens the named job order from the page", async ({ page }) => {
    test.setTimeout(180_000);
    const { user, id, slug } = await partnerWithCompany("recruitment_company");
    execute(
      `update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
       where id = ${literal(id)}`,
    );
    await signInAtAal1(page, user, companyUrl(acme.slug));
    const section = page.getByRole("region", { name: "Job orders" });
    const link = section.getByRole("link", { name: "Acme welders for Vaduz" });
    await expect(link).toHaveAttribute("href", `/en/org/${slug}/job-orders/${named}`);
    await expect(page.locator(`a[href*="${anonymous}"]`)).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("release 2b off: the job orders leave the page", async ({ page }) => {
    setJobOrderRelease(false);
    await page.goto(companyUrl(acme.slug));
    await expect(page.getByRole("heading", { name: "Open vacancies", level: 2 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Job orders" })).toHaveCount(0);
    await expect(page.getByText("Acme welders for Vaduz")).toHaveCount(0);
    setJobOrderRelease(true);
  });
});
