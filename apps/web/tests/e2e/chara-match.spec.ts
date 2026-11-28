import { randomUUID } from "node:crypto";
import type { Response } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal } from "./support/db";
import { pickDate, shownDate } from "./support/date-picker";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser } from "./support/login";
import { seedAllButCv } from "./support/passport";
import { partnerWithCompany, pickWithKeys, setPartnerRelease } from "./support/partners";
import { newTeam, newVisitor, signInAtAal1, signInAtAal2, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// CHARA Match v1 (ARCHITECTURE.md section 9.3, ADR-0005; brief section 7): an employer on a paid plan enters what it needs
// by keyboard, reads the potential workforce network, opens the matches with why each matched, never a worker's name;
// a free employer reads the plan notice instead of results; Find matches on a requirement prefills the form; the page
// does not exist while the release is off. release_chara_match, release 2a, 2b and release_find_workers are set for the
// whole database and workers are made visible, so this file is a project of its own after the release 2c projects.
// Iceland is the destination: no other spec lists a partner or a worker for it, so the counts are the ones made here.

const FIRST = "Odalric";
const LAST = "Thistlewood";
const matchUrl = (slug: string, query = "") => `/en/org/${slug}/match${query ? `?${query}` : ""}`;

function setRelease(key: string, on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

function subscribe(team: Pick<Team, "id">, plan: string): void {
  execute(`insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(team.id)}, ${literal(plan)}, 'active', 'null')`);
}

// A worker who chose to be found: a welder living in the Philippines who wants to work in Iceland.
async function visibleWorker(): Promise<TestUser> {
  const user = await createCommittedUser("worker");
  seedAllButCv(user.id);
  execute(
    `update public.worker_profiles set first_name = ${literal(FIRST)}, last_name = ${literal(LAST)}, occupation_id = '7212',
       current_country = 'PH', availability = 'now', available_from = null
     where user_id = ${literal(user.id)};
     delete from public.worker_preferred_countries where worker_user_id = ${literal(user.id)};
     insert into public.worker_preferred_countries (worker_user_id, country_code) values (${literal(user.id)}, 'IS');
     insert into public.consents (user_id, purpose, version, action)
       values (${literal(user.id)}, 'worker-visibility-consent', private.current_legal_version('worker-visibility-consent'), 'granted');
     update public.worker_profiles set searchable = true where user_id = ${literal(user.id)}`,
  );
  return user;
}

// A listed recruitment company serving Iceland with welders from the Philippines, 30 of them available now.
async function listedPartner(): Promise<{ id: string; slug: string }> {
  const { id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code)
     values (${literal(id)}, 'serves_market', 'IS'), (${literal(id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     insert into public.organization_industries (organization_id, industry_code) values (${literal(id)}, 'F');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days',
       recruitment_type = 'both'
     where id = ${literal(id)};
     insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity, available_from, confirmed_at)
     values (${literal(id)}, '7212', 'PH', 30, 10, current_date, now())`,
  );
  return { id, slug };
}

function startIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  setPartnerRelease(true);
  setRelease("release_job_orders", true);
  setRelease("release_find_workers", true);
  setRelease("release_chara_match", true);
});
test.afterAll(() => {
  setRelease("release_chara_match", false);
  setRelease("release_find_workers", false);
  setRelease("release_job_orders", false);
  setPartnerRelease(false);
});

test.describe("CHARA Match (section 9.3)", () => {
  let acme: Team;
  let workers: TestUser[];
  let partner: { id: string; slug: string };

  test.beforeAll(async () => {
    acme = await newTeam();
    subscribe(acme, "employer_starter");
    partner = await listedPartner();
    workers = [];
    for (let index = 0; index < 5; index++) workers.push(await visibleWorker());
  });

  test("an employer finds matches by keyboard, reads the network and why each matched, never a worker's name", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const responses: Response[] = [];
    page.on("response", (response) => {
      if (baseURL && response.url().startsWith(baseURL)) responses.push(response);
    });
    await signInAtAal1(page, acme.owner, matchUrl(acme.slug));
    await expect(page.getByRole("heading", { name: "CHARA Match", level: 1 })).toBeVisible();

    const destination = page.getByRole("combobox", { name: "Destination country", exact: true });
    await waitForHydration(destination);
    await pickWithKeys(page, "Destination country", "Icel", "Iceland");
    await pickWithKeys(page, "Industry", "Constr", "Construction");
    await pickWithKeys(page, "Occupation", "Welders", "Welders and flame cutters");
    await page.getByLabel("Number of workers", { exact: true }).fill("20");
    await pickDate(page.getByLabel("Start date", { exact: true }), startIn(60));
    await page.getByLabel("Recruitment type", { exact: true }).selectOption("international");
    await page.getByRole("button", { name: "Find matches" }).press("Enter");

    await expect(page).toHaveURL(/\/en\/org\/[^/]+\/match\?run=[0-9a-f-]{36}$/);
    const summary = page.getByTestId("match-summary");
    await expect(summary).toContainText("5 matching workers");
    await expect(summary).toContainText("1 recruitment partner");
    await expect(summary).toContainText("0 staffing partners");
    await expect(summary).toContainText("25–49 workers listed as available by these partners");
    await expect(summary).toContainText("Available source countries: Philippines");
    await expect(page.getByText("not a guarantee", { exact: false }).first()).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("link", { name: "View matches" }).click();
    await expect(page).toHaveURL(/view=workers/);
    const cards = page.getByRole("list", { name: "Workers" }).locator(":scope > li");
    await expect(cards).toHaveCount(5);
    await expect(cards.first().getByTestId("worker-card")).toContainText("Welders and flame cutters");
    await expect(cards.first()).toContainText("Why this match");
    await expect(cards.first()).toContainText("Wants to work in Iceland");

    await page.getByRole("link", { name: "Recruitment partners (1)" }).click();
    const partners = page.getByRole("list", { name: "Recruitment partners" }).locator(":scope > li");
    await expect(partners).toHaveCount(1);
    await expect(partners.first()).toContainText("Serves Iceland");
    await expect(partners.first()).toContainText("Sources workers from Philippines");
    await expect(partners.first().getByRole("link")).toHaveAttribute("href", `/en/partners/${partner.slug}`);
    await expectAccessibleAtBothWidths(page);

    const html = await page.content();
    for (const hidden of [FIRST, LAST, ...workers.flatMap((worker) => [worker.id, worker.email])]) expect(html).not.toContain(hidden);
    for (const response of responses) {
      const body = await response.text().catch(() => "");
      for (const hidden of [FIRST, LAST, ...workers.map((worker) => worker.email)]) expect(body, response.url()).not.toContain(hidden);
    }
  });

  test("Find matches on a workforce requirement opens the form with what it asks for", async ({ page }) => {
    test.setTimeout(180_000);
    const id = randomUUID();
    const start = startIn(90);
    execute(
      `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
         start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
         published_at, closes_on)
       values (${literal(id)}, ${literal(acme.id)}, 'Welders for Reykjavik', 12, 'IS', 'Reykjavik', 'F', date ${literal(start)}, 12, 'full_time',
         'international', 'both', ${literal(acme.owner.id)}, 'open', 'private', false, now() - interval '1 hour', date ${literal(start)} + 30);
       insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 12);
       insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, 'IS')`,
    );
    await signInAtAal2(page, acme.owner, acme.ownerSecret, `/en/org/${acme.slug}/requirements/${id}`);
    await page.getByRole("link", { name: "Find matches" }).click();
    await expect(page).toHaveURL(
      matchUrl(acme.slug, `destination=IS&industry=F&occupation=7212&workers=12&start=${start}&recruitment=international`),
    );
    await expect(page.getByLabel("Number of workers", { exact: true })).toHaveValue("12");
    await expect(page.getByLabel("Start date", { exact: true })).toContainText(shownDate(start));
    await expect(page.getByLabel("Recruitment type", { exact: true })).toHaveValue("international");
  });

  test("a free employer reads the plan notice instead of results; the page is not found while the release is off", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const free = await newTeam();
    const query = `destination=IS&industry=F&occupation=7212&workers=5&start=${startIn(30)}&recruitment=both`;
    await signInAtAal1(page, free.owner, matchUrl(free.slug, query));
    const submit = page.getByRole("button", { name: "Find matches" });
    await waitForHydration(submit);
    await submit.click();
    await expect(page.getByText("CHARA Match is part of every paid employer plan.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Upgrade your plan" })).toHaveAttribute("href", `/en/org/${free.slug}/billing`);
    await expect(page.getByTestId("match-summary")).toHaveCount(0);

    // The page streams behind its loading state, so the not-found page comes with status 200: what it shows is checked.
    const visitor = await newVisitor(browser);
    await visitor.page.goto(matchUrl(acme.slug));
    await expect(visitor.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await visitor.context.close();

    setRelease("release_chara_match", false);
    try {
      await page.goto(matchUrl(free.slug));
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    } finally {
      setRelease("release_chara_match", true);
    }
  });
});
