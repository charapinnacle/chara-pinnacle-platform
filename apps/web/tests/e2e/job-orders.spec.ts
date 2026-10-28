import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { displayName, expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { waitForMessage } from "./support/mailpit";
import { runNotify } from "./support/notify";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { SITE } from "./support/seo";
import { newTeam, newVisitor, signInAtAal1, signInAtAal2, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// The job order marketplace and job order pages (FR-N1 AC2, AC3, AC5, AC7 to AC11, NFR-S11), the new job order alert
// (AC10, FR-T1) and the public Job orders page (FR-L5 AC3, AC9, AC10). Releases 2a and 2b are switched on for the whole
// database, so this file is a project of its own after the partner suggestions, and its tests run one after the other.
// Other specs leave open marketplace requirements behind, so the job orders made here are in Iceland, which no other
// spec uses, and the list is filtered on it.

const ICELAND = "IS";
const listUrl = (slug: string, query = `destination=${ICELAND}`) => `/en/org/${slug}/job-orders${query ? `?${query}` : ""}`;
const orderUrl = (slug: string, id: string) => `/en/org/${slug}/job-orders/${id}`;
const FUNCTION = "public.list_job_orders(uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer)";

function setJobOrderRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

type Partner = { id: string; slug: string; owner: TestUser };

// A listed recruitment company serving p_serves and listing p_occupations, on the paid Basic plan unless free.
async function listedPartner(serves: string[], occupations: string[], { free = false } = {}): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `${serves.map((code) => `insert into public.organization_geographies (organization_id, scope, country_code) values (${literal(id)}, 'serves_market', ${literal(code)});`).join("\n")}
     ${occupations.map((code) => `insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, ${literal(code)});`).join("\n")}
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)};
     ${free ? "" : `insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(id)}, 'recruitment_partner', 'active', 'null');`}`,
  );
  return { id, slug, owner: user };
}

// An open marketplace job order of the team in Iceland, as publish_requirement leaves it, published p_minutes from now
// (in the future, so it is the newest of the database): p_workers of p_occupation in Reykjavik, starting 1 March 2027.
function seedJobOrder(
  team: Pick<Team, "id" | "owner">,
  { title, occupation = "7212", workers = 100, show = false, minutes = 10 }: { title: string; occupation?: string; workers?: number; show?: boolean; minutes?: number },
): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, ${workers}, ${literal(ICELAND)}, 'Reykjavik', 'C', date '2027-03-01', 12,
       'full_time', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', 'job_order_marketplace', ${show},
       now() + interval '${minutes} minutes', date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, ${literal(occupation)}, ${workers});
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(ICELAND)})`,
  );
  return id;
}

function cards(page: Page) {
  return page.getByRole("list", { name: "Job orders" }).getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });
}

function card(page: Page, title: string) {
  return cards(page).filter({ has: page.getByRole("heading", { name: title, level: 2 }) });
}

// Nothing the page sends to the browser (HTML, the RSC payload inlined in it, the title and the meta tags) holds the
// employer's name or id (NFR-S11).
async function expectNoEmployer(page: Page, team: Team): Promise<void> {
  const name = displayName(team.id);
  const html = await page.content();
  expect(html).not.toContain(name);
  expect(html).not.toContain(team.id);
  expect(html).not.toContain(team.slug);
  expect(await page.title()).not.toContain(name);
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  // The job orders of an earlier run of this file would be the newest of the next one.
  execute(`delete from public.workforce_requirements where country_code = ${literal(ICELAND)}`);
  setPartnerRelease(true);
  setJobOrderRelease(true);
});
test.afterAll(() => {
  execute(`grant execute on function ${FUNCTION} to authenticated`);
  setJobOrderRelease(false);
  setPartnerRelease(false);
});

test.describe("The job order marketplace (FR-N1)", () => {
  test("AC11, AC5, AC8: an eligible partner reads the cards, keeps its filters in the address, pages and opens a named and an anonymous job order", async ({ page }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const p1 = await listedPartner([ICELAND], ["7212"]);
    const anonymous = seedJobOrder(team, { title: "Reykjavik harbour welders", minutes: 30 });
    const named = seedJobOrder(team, { title: "Named welders of the yard", workers: 40, show: true, minutes: 20 });
    seedJobOrder(team, { title: "Ten more welders", workers: 10, minutes: 10 });

    await signInAtAal1(page, p1.owner, listUrl(p1.slug));
    await expect(page.getByRole("heading", { name: "Job orders", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "How job orders are ordered" })).toHaveAttribute("href", "/en/legal/ranking");
    await expect(page.getByRole("link", { name: "switch on New job orders that fit" })).toHaveAttribute(
      "href",
      `/en/settings/notifications?org=${p1.slug}`,
    );
    const count = page.getByRole("status").filter({ hasText: /job orders? shown/ });
    await expect(count).toHaveAttribute("aria-live", "polite");
    await expect(count).toHaveText("3 job orders shown");

    const first = card(page, "Iceland, 100 Welders and flame cutters");
    await expect(first).toContainText("Company not named · Manufacturing · Iceland");
    await expect(first).toContainText("100 workers · Starts 1 March 2027 · Fewer than 5 responses");
    const second = card(page, "Named welders of the yard");
    await expect(second).toContainText(`${displayName(team.id)} · Manufacturing · Iceland`);
    // Newest first (AC8): the anonymous one was published last.
    await expect(cards(page).getByRole("heading", { level: 2 })).toHaveText([
      "Iceland, 100 Welders and flame cutters",
      "Named welders of the yard",
      "Iceland, 10 Welders and flame cutters",
    ]);
    await expect(page.getByRole("main")).not.toContainText("Reykjavik harbour welders");
    for (const label of ["Destination country", "Source country", "Occupation", "Industry", "Workers, at least", "Workers, at most", "Starts on or after", "Starts on or before", "Recruitment type"]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // AC7: the filters are written to the address and come back with it.
    const workersMin = page.getByLabel("Workers, at least", { exact: true });
    await waitForHydration(workersMin);
    await workersMin.fill("20");
    await page.getByRole("button", { name: "Show job orders" }).click();
    await expect(page).toHaveURL(listUrl(p1.slug, `destination=${ICELAND}&workers_min=20`));
    await expect(cards(page)).toHaveCount(2);
    await page.reload();
    await expect(page.getByLabel("Workers, at least", { exact: true })).toHaveValue("20");
    await expect(cards(page)).toHaveCount(2);

    // Paging keeps the filters: one job order a page.
    await page.goto(listUrl(p1.slug, `destination=${ICELAND}&limit=1`));
    await expect(cards(page).getByRole("heading", { level: 2 })).toHaveText(["Iceland, 100 Welders and flame cutters"]);
    await expect(count).toHaveText("1 job order shown, more on the next page");
    await page.getByRole("link", { name: "Show more job orders" }).click();
    await expect(page).toHaveURL(listUrl(p1.slug, `destination=${ICELAND}&cursor=${anonymous}&limit=1`));
    await expect(cards(page).getByRole("heading", { level: 2 })).toHaveText(["Named welders of the yard"]);
    await page.getByRole("link", { name: "Back to the first page" }).click();
    await expect(page).toHaveURL(listUrl(p1.slug, `destination=${ICELAND}&limit=1`));

    // A value of the address that does not parse is ignored and named; a filter that matches nothing offers to clear.
    await page.goto(listUrl(p1.slug, `destination=ISL&verified=true`));
    const ignored = page.getByRole("alert").filter({ hasText: "Some filters were ignored" });
    await expect(ignored).toContainText("Select a destination country from the list.");
    await page.goto(listUrl(p1.slug, `destination=${ICELAND}&workers_min=99999`));
    const empty = page.getByRole("status").filter({ hasText: "No job orders match your filters" });
    await expect(empty.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", `/en/org/${p1.slug}/job-orders`);
    await expectNoAxeViolations(page);

    // AC5, NFR-S11: the anonymous job order names no employer anywhere in what the browser receives.
    await page.goto(listUrl(p1.slug));
    await first.getByRole("link", { name: "Iceland, 100 Welders and flame cutters" }).click();
    await expect(page).toHaveURL(orderUrl(p1.slug, anonymous));
    await expect(page.getByRole("heading", { name: "Iceland, 100 Welders and flame cutters", level: 1 })).toBeVisible();
    await expect(page.getByText("Company not named", { exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Reykjavik, Iceland");
    await expect(page.getByRole("main")).toContainText("7212 · Welders and flame cutters");
    expect(await page.title()).toMatch(/^Job order/);
    // Loaded on its own: the list before it named the other job order's employer, as it may.
    await page.goto(orderUrl(p1.slug, anonymous));
    await expectNoEmployer(page, team);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(orderUrl(p1.slug, named));
    await expect(page.getByRole("heading", { name: "Named welders of the yard", level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(displayName(team.id));
    await expectNoAxeViolations(page);
  });

  test("AC11: at 360 px a partner reaches a job order by keyboard alone", async ({ page }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    const p1 = await listedPartner([ICELAND], ["7212"]);
    const id = seedJobOrder(team, { title: "Keyboard welders", workers: 12, minutes: 40 });
    await page.setViewportSize({ width: 360, height: 800 });
    await signInAtAal1(page, p1.owner, listUrl(p1.slug));
    const link = card(page, "Iceland, 12 Welders and flame cutters").getByRole("link", { name: "Iceland, 12 Welders and flame cutters" });
    await waitForHydration(page.getByRole("button", { name: "Show job orders" }));
    let reached = false;
    for (let step = 0; step < 80 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await link.evaluate((element) => element === document.activeElement);
    }
    expect(reached).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(orderUrl(p1.slug, id));
  });

  test("AC3: a partner that sees titles only reads the destination, the size and why, with the way to fix it; a revealed partner reads the name", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const id = seedJobOrder(team, { title: "Reduced welders", workers: 60, minutes: 50 });
    const p2 = await listedPartner(["PL"], ["7212"]);
    const p4 = await listedPartner([ICELAND], ["7212"], { free: true });
    const p3 = await listedPartner(["PL"], ["7212"]);
    execute(`insert into private.requirement_reveals (requirement_id, organization_id, cause) values (${literal(id)}, ${literal(p3.id)}, 'invitation')`);

    await signInAtAal1(page, p2.owner, listUrl(p2.slug));
    const reduced = card(page, "Iceland, 60 Welders and flame cutters");
    await expect(reduced).toContainText("Iceland · 60 workers");
    await expect(reduced).toContainText("Add Iceland to the countries you serve to see this job order.");
    await expect(reduced.getByRole("link", { name: "Edit the countries you serve" })).toHaveAttribute(
      "href",
      `/en/org/${p2.slug}/workforce-profile#where-you-serve-heading`,
    );
    await expect(reduced).not.toContainText("Company not named");
    await expect(reduced).not.toContainText("Starts");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await reduced.getByRole("link", { name: "Iceland, 60 Welders and flame cutters" }).click();
    await expect(page.getByRole("heading", { name: "Only the title is shown to your company" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("main")).not.toContainText("Reykjavik");
    await expect(page.getByRole("main")).not.toContainText("Occupations");
    await expectNoEmployer(page, team);
    await expectNoAxeViolations(page);

    const free = await newVisitor(browser);
    await signInAtAal1(free.page, p4.owner, orderUrl(p4.slug, id));
    await expect(free.page.getByText("Job orders are shown in full on a paid partner plan.")).toBeVisible();
    // The owner manages the plan; the link leads to billing.
    await expect(free.page.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", `/en/org/${p4.slug}/billing`);
    await free.context.close();

    const revealed = await newVisitor(browser);
    await signInAtAal1(revealed.page, p3.owner, orderUrl(p3.slug, id));
    await expect(revealed.page.getByRole("main")).toContainText(displayName(team.id));
    await expect(revealed.page.getByRole("heading", { name: "Only the title is shown to your company" })).toBeVisible();
    await revealed.context.close();
  });

  test("AC9: a job order the employer closes leaves the list at once and its saved address says it is no longer open", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const p1 = await listedPartner([ICELAND], ["7212"]);
    const id = seedJobOrder(team, { title: "Closing welders", workers: 33, minutes: 60 });
    await signInAtAal1(page, p1.owner, listUrl(p1.slug));
    await expect(card(page, "Iceland, 33 Welders and flame cutters")).toBeVisible();

    const owner = await newVisitor(browser);
    await signInAtAal2(owner.page, team.owner, team.ownerSecret, `/en/org/${team.slug}/requirements/${id}`);
    const close = owner.page.getByRole("button", { name: "Close", exact: true });
    await waitForHydration(close);
    await close.click();
    const dialog = owner.page.getByRole("dialog", { name: "Close this requirement" });
    await dialog.getByRole("radio", { name: "Cancelled", exact: true }).check();
    await dialog.getByRole("button", { name: "Close requirement" }).click();
    await expect(owner.page.getByRole("status").filter({ hasText: "Closed - final" })).toBeVisible();
    await owner.context.close();

    await page.reload();
    await expect(card(page, "Iceland, 33 Welders and flame cutters")).toHaveCount(0);
    await page.goto(orderUrl(p1.slug, id));
    await expect(page.getByText("This job order is no longer open", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Job order", level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("Welders");
    await expect(page.getByRole("main")).not.toContainText("Iceland");
    await expect(page.getByRole("button", { name: /respond/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /respond/i })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
  });

  test("AC11: a failed read shows a toast and a retry; a company not listed is told why", async ({ page }) => {
    test.setTimeout(180_000);
    const p1 = await listedPartner([ICELAND], ["7212"]);
    await signInAtAal1(page, p1.owner, listUrl(p1.slug));
    await expect(page.getByRole("heading", { name: "Job orders", level: 1 })).toBeVisible();
    execute(`revoke execute on function ${FUNCTION} from authenticated`);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "The job orders could not be loaded" })).toBeVisible();
      await expect(page.getByText("Check your connection and try again.", { exact: true })).toBeVisible();
      await expectNoAxeViolations(page);
    } finally {
      execute(`grant execute on function ${FUNCTION} to authenticated`);
    }
    const retry = page.getByRole("button", { name: "Try again" });
    await waitForHydration(retry);
    await retry.click();
    await expect(page.getByRole("heading", { name: "Job orders", level: 1 })).toBeVisible();

    execute(`update public.organizations set listed_at = null, review_status = 'pending_review' where id = ${literal(p1.id)}`);
    await page.reload();
    await expect(page.getByText("Job orders are shown to companies listed in the partner directories. Yours is not listed yet.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Job orders" })).toHaveCount(0);
  });

  test("AC10: an owner who switched the alert on is told of a new job order that fits, in the app and by email, without the employer", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const p1 = await listedPartner([ICELAND], ["7212"]);
    const quiet = await listedPartner([ICELAND], ["7212"]);

    await signInAtAal1(page, p1.owner, "/en/settings/notifications");
    const section = page.locator("#email-notifications");
    const alert = section.getByRole("switch", { name: "New job orders that fit" });
    await expect(alert).not.toBeChecked();
    await waitForHydration(alert);
    await alert.click();
    await section.getByRole("button", { name: "Save email choices" }).click();
    await expect(page.getByText("Email choices saved", { exact: true })).toBeVisible();

    const id = randomUUID();
    execute(
      `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
         start_date, employment_type, recruitment_preference, partner_need, created_by, status)
       values (${literal(id)}, ${literal(team.id)}, 'Alert welders', 30, ${literal(ICELAND)}, 'Reykjavik', 'C', current_date + 60, 'full_time',
         'international', 'recruitment', ${literal(team.owner.id)}, 'draft');
       insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 30);
       insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(ICELAND)})`,
    );
    const owner = await newVisitor(browser);
    await signInAtAal2(owner.page, team.owner, team.ownerSecret, `/en/org/${team.slug}/requirements/${id}`);
    const publishButton = owner.page.getByRole("button", { name: "Publish", exact: true });
    await waitForHydration(publishButton);
    await publishButton.click();
    const publish = owner.page.getByRole("dialog", { name: "Publish this requirement" });
    await publish.getByRole("radio", { name: "Job order marketplace", exact: true }).check();
    await publish.getByRole("button", { name: "Publish requirement" }).click();
    await expect(owner.page.getByText("The requirement is published", { exact: true })).toBeVisible();
    await owner.context.close();

    const alerts = (userId: string) =>
      query<{ status: string; payload: string }>(
        `select status, payload::text from public.notifications where user_id = ${literal(userId)} and kind = 'job_order_match'`,
      );
    expect(alerts(p1.owner.id)).toHaveLength(1);
    expect(alerts(p1.owner.id)[0].status).toBe("queued");
    expect(alerts(p1.owner.id)[0].payload).not.toContain(displayName(team.id));
    expect(alerts(quiet.owner.id)).toHaveLength(0);

    await page.goto("/en/notifications");
    const item = page.getByRole("link", { name: "New job order: Iceland, 30 Welders and flame cutters" });
    await waitForHydration(item);
    await expectNoAxeViolations(page);
    await item.click();
    await expect(page).toHaveURL(orderUrl(p1.slug, id));
    await expect(page.getByText("Company not named", { exact: true })).toBeVisible();

    await runNotify();
    const email = await waitForMessage(p1.owner.email, { subject: "New job order: Iceland, 30 Welders and flame cutters" });
    expect(email.Text).toContain(`${SITE}/en/org/${p1.slug}/job-orders/${id}`);
    expect(`${email.Subject}\n${email.Text}\n${email.HTML}`).not.toContain(displayName(team.id));
  });
});

test.describe("The public Job orders page (FR-L5)", () => {
  test("AC3, AC10: the page, its Menu link and its sitemap entry exist only while release 2b is on, and How it works links it (AC9)", async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.goto("/en/job-orders");
    await expect(page.getByRole("heading", { name: "Job orders", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up as a recruitment company" })).toHaveAttribute("href", "/en/signup?kind=recruitment_company");
    await expect(page.getByRole("link", { name: "Sign in" }).last()).toHaveAttribute("href", `/en/login?next=${encodeURIComponent("/en/job-orders")}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/en");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu.getByRole("navigation", { name: "Explore" }).getByRole("link", { name: "Job orders" })).toHaveAttribute("href", "/en/job-orders");
    await expect(menu.getByRole("list", { name: "Coming in a later phase" })).not.toContainText("Job orders");
    expect(await (await request.get("/sitemap.xml")).text()).toContain(`<loc>${SITE}/en/job-orders</loc>`);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/en/how-it-works");
    await expect(page.getByRole("main").getByRole("link", { name: "job orders" })).toHaveAttribute("href", "/en/job-orders");

    setJobOrderRelease(false);
    try {
      expect((await request.get("/en/job-orders")).status()).toBe(404);
      expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/en/job-orders</loc>");
      expect(await (await request.get("/en")).text()).not.toContain('href="/en/job-orders"');
    } finally {
      setJobOrderRelease(true);
    }
  });

  test("a partner owner is led from the public page to its company's job orders", async ({ page }) => {
    const p1 = await listedPartner([ICELAND], ["7212"]);
    await signInAtAal1(page, p1.owner, "/en/job-orders");
    const link = page.getByRole("link", { name: /^Job orders for / });
    await expect(link).toHaveAttribute("href", `/en/org/${p1.slug}/job-orders`);
    await link.click();
    await expect(page.getByRole("heading", { name: "Job orders", level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    // The marketplace and the job order pages do not exist while release 2b is off (the app's not-found page; the
    // signed-in area streams behind its skeleton, so the status is sent before the page knows).
    setJobOrderRelease(false);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await page.goto(orderUrl(p1.slug, randomUUID()));
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    } finally {
      setJobOrderRelease(true);
    }
  });
});
