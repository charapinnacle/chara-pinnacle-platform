import { randomUUID } from "node:crypto";
import type { Page, Response } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { uniqueToken } from "./support/organizations";
import { seedAllButCv, signIn } from "./support/passport";
import { setPartnerRelease } from "./support/partners";
import { enforceLimits, newTeam, newVisitor, restoreLimits, signInAtAal1, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// Find Workers (V69; FR-Q2 AC10, AC11, AC12; FR-L5 AC3, AC10; NFR-S9, NFR-U3, NFR-U4): the search of an employer on a paid
// plan by keyword and keyboard, the cards with what they matched and the direct-hiring rule, no name or contact detail in
// the page source or any response, saving a card, the empty state and a failure with retry, the way from a requirement,
// and who sees the page. Releases 2a, 2b and 2c's release_find_workers are set for the whole database and a function is
// withdrawn from the API role, so this file is a project of its own after the Find Workers opt-in.

const SEARCH_WORKERS = "public.search_workers(uuid, jsonb, text, integer)";
const FIRST = "Zarina";
const LAST = "Quillfeather";

function setRelease(key: string, on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

const searchUrl = (slug: string, query = "") => `/en/org/${slug}/find-workers${query ? `?${query}` : ""}`;

// A visible worker living in p_country, welder, whose headline holds p_token so that a search finds only the workers of
// one test, with a name that must never appear.
async function visibleWorker(token: string, country: string): Promise<TestUser> {
  const user = await createCommittedUser("worker");
  seedAllButCv(user.id);
  execute(
    `update public.worker_profiles set first_name = ${literal(FIRST)}, last_name = ${literal(LAST)}, occupation_id = '7212',
       current_country = ${literal(country)}, headline = ${literal(`MIG welder ${token}`)}
     where user_id = ${literal(user.id)};
     insert into public.consents (user_id, purpose, version, action)
       values (${literal(user.id)}, 'worker-visibility-consent', private.current_legal_version('worker-visibility-consent'), 'granted');
     update public.worker_profiles set searchable = true where user_id = ${literal(user.id)}`,
  );
  return user;
}

function subscribe(team: Pick<Team, "id">, plan: string): void {
  execute(`insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(team.id)}, ${literal(plan)}, 'active', 'null')`);
}

function seedRequirement(team: Team): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, 'Welders for Hamburg', 20, 'DE', 'Hamburg', 'C', date '2027-03-01', 12, 'full_time',
       'international', 'both', ${literal(team.owner.id)}, 'open', 'private', false, now() - interval '1 hour', date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 20);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, 'DE')`,
  );
  return id;
}

const cards = (page: Page) => page.getByRole("list", { name: "Workers" }).locator(":scope > li");

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  setPartnerRelease(true);
  setRelease("release_job_orders", true);
  setRelease("release_find_workers", true);
  execute(`delete from public.direct_hiring_rules where source_country = 'NP'`);
  execute(
    `insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref)
     values ('NP', null, 'licensed_partner_required', 'Hiring from Nepal needs a licensed recruitment partner.', 'E2E-V69')`,
  );
});
test.afterAll(() => {
  restoreLimits();
  execute(`grant execute on function ${SEARCH_WORKERS} to authenticated`);
  execute(`delete from public.direct_hiring_rules where legal_opinion_ref = 'E2E-V69'`);
  setRelease("release_find_workers", false);
  setRelease("release_job_orders", false);
  setPartnerRelease(false);
});

test.describe("Find Workers (FR-Q2)", () => {
  let acme: Team;
  let token: string;
  let nepal: TestUser;
  let nigeria: TestUser;

  test.beforeAll(async () => {
    acme = await newTeam();
    subscribe(acme, "employer_starter");
    token = `kestrel${uniqueToken()}`;
    nepal = await visibleWorker(token, "NP");
    nigeria = await visibleWorker(token, "NG");
  });

  test("AC10, NFR-S9: an admin searches by keyboard; cards show the fields, what they matched and the rule, never a name", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const responses: Response[] = [];
    page.on("response", (response) => {
      if (baseURL && response.url().startsWith(baseURL)) responses.push(response);
    });
    // Until billing is live every plan has every feature; Starter's filters are locked once the limits apply.
    enforceLimits();
    await signInAtAal1(page, acme.owner, searchUrl(acme.slug));
    await expect(page.getByRole("heading", { name: "Find workers", level: 1 })).toBeVisible();
    const box = page.getByLabel("Search workers", { exact: true });
    await expect(box).toHaveAttribute("placeholder", "Welders, truck drivers, electricians, cooks");
    for (const label of ["Occupation", "Lives in", "Destination country", "Availability"]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("group", { name: "More filters" })).toContainText("available on Professional and Enterprise");
    restoreLimits();

    await waitForHydration(box);
    await box.fill(token);
    await box.press("Enter");
    await expect(page).toHaveURL(searchUrl(acme.slug, `q=${token}`));
    await expect(page.getByRole("status").filter({ hasText: "2 workers found." })).toBeVisible();
    await expect(cards(page)).toHaveCount(2);

    const nepalCard = cards(page).filter({ hasText: "Nepal" });
    await expect(nepalCard.getByTestId("worker-card")).toContainText("Welders and flame cutters");
    await expect(nepalCard.getByTestId("worker-card")).toContainText(`MIG welder ${token}`);
    await expect(nepalCard).toContainText("Matched on: headline");
    await expect(nepalCard).toContainText("Contact through a licensed partner");
    await expect(nepalCard).toContainText("Hiring from Nepal needs a licensed recruitment partner.");
    await expect(nepalCard.getByRole("link", { name: "Find recruitment partners for workers from Nepal" })).toHaveAttribute(
      "href",
      "/en/partners/recruitment?sources_from=NP",
    );
    const nigeriaCard = cards(page).filter({ hasText: "Nigeria" });
    await expect(nigeriaCard).not.toContainText("Contact through a licensed partner");

    const html = await page.content();
    for (const hidden of [FIRST, LAST, nepal.id, nigeria.id, nepal.email, nigeria.email]) expect(html).not.toContain(hidden);
    for (const response of responses) {
      const body = await response.text().catch(() => "");
      for (const hidden of [FIRST, LAST, nepal.id, nigeria.id, nepal.email]) expect(body, response.url()).not.toContain(hidden);
    }
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const save = nigeriaCard.getByRole("button", { name: /^Save: / });
    await waitForHydration(save);
    await save.click();
    await expect(page.getByText("Worker saved", { exact: true })).toBeVisible();
    const saved = page.getByRole("region", { name: "Saved workers" });
    await expect(saved.getByTestId("worker-card")).toContainText("Nigeria");
    await expect(saved.getByRole("button", { name: /^Remove from saved: / })).toBeVisible();
  });

  test("AC10: no result shows Clear filters; a failure toasts and retries", async ({ page }) => {
    test.setTimeout(180_000);
    await signInAtAal1(page, acme.owner, searchUrl(acme.slug, `q=nothing${uniqueToken()}`));
    await expect(page.getByRole("heading", { name: "No workers match your search" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", searchUrl(acme.slug));
    await expectNoAxeViolations(page);

    execute(`revoke execute on function ${SEARCH_WORKERS} from authenticated`);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "The workers could not be loaded" })).toBeVisible();
      await expectNoAxeViolations(page);
    } finally {
      execute(`grant execute on function ${SEARCH_WORKERS} to authenticated`);
    }
    const retry = page.getByRole("button", { name: "Try again" });
    await waitForHydration(retry);
    await retry.click();
    await expect(page.getByRole("heading", { name: "No workers match your search" })).toBeVisible();
  });

  test("AC10, AC12: Find workers for this requirement prefills it and keeps the saved cards with it", async ({ page }) => {
    test.setTimeout(180_000);
    const requirement = seedRequirement(acme);
    await signInAtAal1(page, acme.owner, `/en/org/${acme.slug}/requirements/${requirement}`);
    await page.getByRole("link", { name: "Find workers for this requirement" }).click();
    await expect(page).toHaveURL(searchUrl(acme.slug, `requirement=${requirement}&occupation=7212&destination=DE`));
    await expect(page.getByText("Searching for the requirement")).toBeVisible();
    await expect(page.getByText(/Matched on: .*destination DE/)).toHaveCount(0);
    await expect(page.getByText("Matched on: your search")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Saved for this requirement", level: 2 })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
  });

  test("AC11: a free employer reads the explanation, a worker and a visitor are not found, the public page shows no worker", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const free = await newTeam();
    await signInAtAal1(page, free.owner, searchUrl(free.slug));
    await expect(page.getByText("Find Workers is part of the paid plans.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Upgrade your plan" })).toHaveAttribute("href", `/en/org/${free.slug}/billing`);
    await expect(page.getByRole("list", { name: "Workers" })).toHaveCount(0);

    const worker = await newVisitor(browser);
    await signIn(worker.page, nigeria);
    const asWorker = await worker.page.goto(searchUrl(acme.slug));
    expect(asWorker?.status()).toBe(404);
    await worker.context.close();

    const visitor = await newVisitor(browser);
    expect((await visitor.page.goto(searchUrl(acme.slug)))?.status()).toBe(404);
    await visitor.page.goto("/en/find-workers");
    await expect(visitor.page.getByRole("heading", { name: "Find workers", level: 1 })).toBeVisible();
    const main = visitor.page.getByRole("main");
    await expect(main.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/en/login?next=%2Fen%2Ffind-workers");
    await expect(main.getByRole("link", { name: "See the plans" })).toHaveAttribute("href", "/en/pricing");
    expect(await visitor.page.content()).not.toContain(token);
    await expectAccessibleAtBothWidths(visitor.page);
    await visitor.context.close();

    const member = await newVisitor(browser);
    await logIn(member.page, acme.owner, "/en/find-workers");
    await expect(member.page.getByRole("link", { name: /^Find workers for / })).toHaveAttribute("href", searchUrl(acme.slug));
    await member.context.close();
  });
});
