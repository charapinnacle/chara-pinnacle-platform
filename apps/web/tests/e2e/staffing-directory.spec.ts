import type { Browser, Locator, Page } from "@playwright/test";
import { signInStaff } from "./support/admin";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, executeAsync, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import { registerOrganization, uniqueName, uniqueToken } from "./support/organizations";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { readHead, SITE } from "./support/seo";
import { expect, test, visitorAddress } from "./support/test";
import type { TestUser } from "./support/test-user";

const DIRECTORY = "/en/partners/staffing";
const SEARCH_PARTNERS =
  "public.search_partners(text, text, text, text, text[], text, text, public.recruitment_preference, text[], text, integer, integer, text, integer, text, text)";
const SEARCH_WORKFORCE = "public.search_available_workforce(text, text, integer, integer, text, integer)";
const FORBIDDEN_WORDS = /\b(verified|approved|licensed|rating|reviews?|score|badge|basic|professional|enterprise|plan)\b/i;
const CONTACT_ACTIONS = /^(Save partner|Follow|Send inquiry|Request workforce|Invite to a requirement)/;

type Batch = { owner: TestUser; token: string; staffing: string; recruitment: string };

// A listed staffing company serving Germany and the Netherlands (temporary and contract staffing, 120 welders from the
// Philippines confirmed twelve days ago, 40 a month) and a listed recruitment company serving Germany that also offers
// permanent staffing, owned by one partner user. Their profile times lie ahead of every other partner of the database,
// so they come first.
async function staffingBatch(): Promise<Batch> {
  const { user } = await partnerWithCompany("staffing_company");
  const token = uniqueToken();
  execute(
    `with created as (
       insert into public.organizations (type, slug, legal_name, display_name, based_in_country)
       values ('staffing_company', 'staff-' || ${literal(token)} || '-1', 'Staff Legal ' || ${literal(token)} || ' Inc.',
               'Staff Supplier ' || ${literal(token)}, 'PH'),
              ('recruitment_company', 'staff-' || ${literal(token)} || '-2', 'Staff Legal ' || ${literal(token)} || ' Two Inc.',
               'Staff Recruiter ' || ${literal(token)}, 'PH')
       returning id, type, slug
     ), members as (
       insert into public.organization_members (organization_id, user_id, role, accepted_at)
       select id, ${literal(user.id)}, 'owner', now() from created
     ), geographies as (
       insert into public.organization_geographies (organization_id, scope, country_code)
       select id, 'serves_market'::public.geography_scope, 'DE' from created
       union all select id, 'sources_from', 'PH' from created
       union all select id, 'serves_market', 'NL' from created where type = 'staffing_company'
     ), services as (
       insert into public.organization_service_types (organization_id, service)
       select id, s::public.partner_service_type from created
       cross join unnest(case when type = 'staffing_company' then array['temporary', 'contract'] else array['staffing', 'permanent'] end) s
     )
     insert into public.organization_occupations (organization_id, occupation_id) select id, '7212' from created;
     update public.organizations set review_status = 'listed', listed_at = now() - interval '2 days',
       submitted_at = now() - interval '3 days',
       workforce_profile_updated_at = now() + interval '1 day' - make_interval(mins => split_part(slug, '-', 3)::integer)
     where slug like ${literal(`staff-${token}-%`)};
     insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
       available_from, confirmed_at)
     select id, '7212', 'PH', 120, 40, current_date, now() - interval '12 days'
     from public.organizations where slug = ${literal(`staff-${token}-1`)}`,
  );
  return { owner: user, token, staffing: `Staff Supplier ${token}`, recruitment: `Staff Recruiter ${token}` };
}

// Listed staffing companies serving Luxembourg, each with 150 welders available now; the first is confirmed most
// recently, so the available workforce search returns them in the order of their number.
async function luxembourgSuppliers(count: number): Promise<string[]> {
  const { user } = await partnerWithCompany("staffing_company");
  const token = uniqueToken();
  execute(
    `with created as (
       insert into public.organizations (type, slug, legal_name, display_name, based_in_country)
       select 'staffing_company', 'lux-' || ${literal(token)} || '-' || n, 'Lux Legal ' || ${literal(token)} || ' ' || n,
         'Lux Supplier ' || ${literal(token)} || ' ' || lpad(n::text, 2, '0'), 'PH'
       from generate_series(1, ${count}) n
       returning id, slug
     ), members as (
       insert into public.organization_members (organization_id, user_id, role, accepted_at)
       select id, ${literal(user.id)}, 'owner', now() from created
     ), geographies as (
       insert into public.organization_geographies (organization_id, scope, country_code)
       select id, s.scope::public.geography_scope, s.code from created
       cross join (values ('serves_market', 'LU'), ('sources_from', 'PH')) s (scope, code)
     ), services as (
       insert into public.organization_service_types (organization_id, service) select id, 'temporary' from created
     )
     insert into public.organization_occupations (organization_id, occupation_id) select id, '7212' from created;
     update public.organizations set review_status = 'listed', listed_at = now() - interval '2 days',
       submitted_at = now() - interval '3 days'
     where slug like ${literal(`lux-${token}-%`)};
     insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
       available_from, confirmed_at)
     select id, '7212', 'PH', 150, 10, current_date, now() - make_interval(mins => split_part(slug, '-', 3)::integer)
     from public.organizations where slug like ${literal(`lux-${token}-%`)}`,
  );
  return Array.from({ length: count }, (_, index) => `Lux Supplier ${token} ${String(index + 1).padStart(2, "0")}`);
}

// The date as the pages write it (lib/i18n/format.ts formatDate), in UTC.
const longDate = (date: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(date);
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const cards = (page: Page) =>
  page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });

async function signedIn(browser: Browser, user: TestUser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": visitorAddress() } });
  const page = await context.newPage();
  await logIn(page, user);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  return { context, page };
}

async function newEmployer(): Promise<TestUser> {
  const employer = await createCommittedUser("company");
  await registerOrganization(employer, `${uniqueName("Staffing Searcher")} GmbH`);
  return employer;
}

async function choose(page: Page, field: Locator, typed: string, option: string | RegExp) {
  await field.fill(typed);
  await page.getByRole("option", { name: option }).first().click();
}

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// recruitment directory spec (playwright.config.ts), and the tests run one after the other.
test.describe("Find staffing partners and available workforce (FR-L2, FR-K3)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("FR-L2 AC6, AC1: a visitor filters by market and staffing type and reads the cards", async ({ page }) => {
    test.setTimeout(120_000);
    const batch = await staffingBatch();
    await page.goto(DIRECTORY);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find Staffing Partners");
    await expect(page.getByRole("region", { name: "Available workforce" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Language" })).toHaveCount(0);
    const destination = page.getByRole("combobox", { name: "Destination country" });
    await waitForHydration(destination);
    await choose(page, destination, "Germany", /^Germany$/);
    await page.getByRole("group", { name: "Staffing type" }).getByRole("checkbox", { name: "Temporary" }).check();
    await page.getByRole("button", { name: "Search partners" }).click();
    await expect(page).toHaveURL(`${DIRECTORY}?destination=DE&staffing_type=temporary`);

    const supplier = cards(page).filter({ hasText: batch.staffing });
    await expect(supplier).toHaveCount(1);
    await expect(cards(page).first().getByRole("heading", { level: 2 })).toHaveText(batch.staffing);
    await expect(supplier).toContainText("Markets served: Germany, Netherlands");
    await expect(supplier).toContainText("Staffing types: Temporary, Contract");
    await expect(supplier, "FR-K3 AC4: a visitor reads no capacity").not.toContainText("120 available");
    await expect(supplier.getByRole("link", { name: `Sign in to see the available workforce of ${batch.staffing}` })).toBeVisible();
    await expect(supplier).toContainText("Matches: destination, staffing type");
    await expect(supplier).not.toContainText("also offers staffing");
    await expect(supplier.getByRole("link", { name: batch.staffing, exact: true })).toHaveAttribute(
      "href",
      `/en/partners/staff-${batch.token}-1`,
    );
    const recruiter = cards(page).filter({ hasText: batch.recruitment });
    await expect(recruiter).toContainText("Recruitment company, also offers staffing");
    await expect(recruiter).toContainText("Staffing types: Permanent");
    await expect(recruiter).toContainText("Matches: destination");
    expect(await page.getByRole("main").getByRole("list").first().innerText()).not.toMatch(FORBIDDEN_WORDS);
    const html = await page.content();
    expect(html).not.toContain(`Staff Legal ${batch.token}`);
    expect(html).not.toContain(batch.owner.email);

    await expect(page).toHaveTitle(/Find staffing partners/);
    const head = await readHead(page);
    expect(head.canonical).toBe(`${SITE}${DIRECTORY}`);
    await expectAccessibleAtBothWidths(page);

    await page.goto("/en/partners/recruitment?destination=DE");
    await expect(cards(page).filter({ hasText: batch.recruitment })).toHaveCount(1);
    await expect(cards(page).filter({ hasText: batch.staffing })).toHaveCount(0);
  });

  test("FR-L2 AC8: the actions depend on the viewer", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const batch = await staffingBatch();
    const address = `${DIRECTORY}?destination=DE`;
    await page.goto(address);
    const card = cards(page).filter({ hasText: batch.staffing });
    const contact = card.getByRole("link", { name: `Sign up to contact ${batch.staffing}` });
    await expect(contact).toHaveAttribute("href", "/en/signup?kind=company");
    let reached = false;
    for (let step = 0; step < 80 && !reached; step++) {
      await page.keyboard.press("Tab");
      reached = await contact.evaluate((element) => element === document.activeElement);
    }
    expect(reached, "Sign up to contact is reachable by Tab").toBe(true);

    const viewers: [string, TestUser][] = [
      ["candidate", await createCommittedUser("worker")],
      ["partner member", batch.owner],
      ["employer admin", await newEmployer()],
    ];
    for (const [label, user] of viewers) {
      const { context, page: viewerPage } = await signedIn(browser, user);
      await viewerPage.goto(address);
      const viewerCard = cards(viewerPage).filter({ hasText: batch.staffing });
      await expect(viewerCard, label).toHaveCount(1);
      await expect(viewerCard.getByRole("link", { name: /Sign up to contact/ }), label).toHaveCount(0);
      // Save partner and Follow (FR-L4, V24): employers save and follow, candidates follow, the partner's own member neither.
      const actions: Record<string, string[]> = { candidate: ["Follow"], "partner member": [], "employer admin": ["Save partner", "Follow"] };
      const expected = actions[label] ?? [];
      await expect(viewerCard.getByRole("button", { name: CONTACT_ACTIONS }), label).toHaveCount(expected.length);
      for (const action of expected) {
        await expect(viewerCard.getByRole("button", { name: `${action}: ${batch.staffing}` }), label).toHaveAttribute("aria-pressed", "false");
      }
      await expect(viewerPage.getByRole("region", { name: "Available workforce" }), label).toHaveCount(label === "employer admin" ? 1 : 0);
      await expect(viewerCard, `FR-K3 AC4: ${label} reads the capacity`).toContainText(
        `Welders and flame cutters: 120 available, confirmed ${longDate(daysAgo(12))}`,
      );
      await context.close();
    }
  });

  test("FR-L2 AC10: the empty state, the skeleton, the keyboard and the 360 px layout", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`${DIRECTORY}?destination=XX&staffing_type=gig&language=tl`);
    await expect(page.getByRole("alert").filter({ hasText: "Select staffing types from the list." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No staffing partners match your search" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", DIRECTORY);
    await expect(page.getByRole("link", { name: "Find Recruitment Partners" })).toHaveAttribute("href", "/en/partners/recruitment");
    for (const label of ["Destination country", "Occupation", "Based in", "Industry", "Workforce size"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessibleAtBothWidths(page);

    await page.goto(DIRECTORY);
    const destination = page.getByRole("combobox", { name: "Destination country" });
    await waitForHydration(destination);
    await destination.focus();
    await page.keyboard.type("Germany");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Enter");
    const button = page.getByRole("button", { name: "Search partners" });
    for (let step = 0; step < 5; step++) {
      if (await button.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${DIRECTORY}?destination=DE`);
    await expect(page.getByRole("status").filter({ hasText: "shown" })).toHaveAttribute("aria-live", "polite");

    // The lock is held for less than the 3 s statement timeout of anon, so the search waits instead of failing.
    const held = executeAsync("begin; lock table public.organization_geographies in access exclusive mode; select pg_sleep(2); commit;");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.goto(`${DIRECTORY}?destination=NL`, { waitUntil: "commit" });
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "shown" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
    await held;
  });

  test("FR-L2 AC10: a failed search shows a toast and Try again, and retrying shows the results", async ({ page }) => {
    try {
      execute(`revoke execute on function ${SEARCH_PARTNERS} from anon, authenticated`);
      await page.goto(`${DIRECTORY}?destination=DE`);
      await expect(page.getByRole("heading", { name: "The staffing partners could not be loaded" })).toBeVisible();
      await expect(page.getByRole("region", { name: /Notification/ }).getByText("The staffing partners could not be loaded")).toBeVisible();
      await expect(page.getByText("permission denied")).toHaveCount(0);
    } finally {
      execute(`grant execute on function ${SEARCH_PARTNERS} to anon, authenticated`);
    }
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Find Staffing Partners" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "shown" })).toBeVisible();
  });

  test("FR-L2 AC10, AC11: over the visitor limit the page says so, and every first page is logged without personal data", async ({ page }) => {
    await page.goto(`${DIRECTORY}?destination=DE&staffing_type=temporary&workforce_size=50_249`);
    await expect(page.getByRole("status").filter({ hasText: "shown" })).toBeVisible();
    const [row] = query<{ kind: string; filters: string; destination: string }>(
      `select kind, array_to_string(filter_names, ',') as filters, destination_country as destination
       from stats.partner_searches order by id desc limit 1`,
    );
    expect(row).toEqual({ kind: "staffing", filters: "destination,staffing_type,workforce_size", destination: "DE" });

    execute(`update private.settings set value = '1' where key = 'rate_limit_partner_search_max'`);
    try {
      await page.goto(`${DIRECTORY}?destination=DE`);
      await expect(page.getByText("Too many searches. Please wait a minute and try again.")).toBeVisible();
      await expect(cards(page)).toHaveCount(0);
      await page.setViewportSize({ width: 360, height: 800 });
      await expectAccessibleAtBothWidths(page);
    } finally {
      execute(`update private.settings set value = '60' where key = 'rate_limit_partner_search_max'`);
    }
  });

  test("FR-K3 AC9: an employer searches the available workforce by keyboard", async ({ browser }) => {
    test.setTimeout(120_000);
    const batch = await staffingBatch();
    const { context, page } = await signedIn(browser, await newEmployer());
    await page.goto(DIRECTORY);
    const section = page.getByRole("region", { name: "Available workforce" });
    const occupation = section.getByRole("combobox", { name: "Occupation" });
    await waitForHydration(occupation);
    for (const label of ["Occupation", "Destination", "Workers needed", "Within (days)"]) {
      await expect(section.getByText(label, { exact: true })).toBeVisible();
    }
    await occupation.focus();
    await page.keyboard.type("Welders");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Germany");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("100");
    await page.keyboard.press("Tab");
    await page.keyboard.type("60");

    // The listings are locked for a moment, so the skeleton shows while the search waits.
    const held = executeAsync("begin; lock table public.workforce_availability in access exclusive mode; select pg_sleep(1.5); commit;");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.keyboard.press("Enter");
    await expect(section.getByRole("status", { name: "Loading" })).toBeVisible();
    await held;
    const results = section.getByRole("list", { name: "Partners with available workforce" });
    const supplier = results.getByRole("listitem").filter({ has: page.getByRole("heading", { name: batch.staffing }) });
    await expect(supplier).toHaveCount(1);
    await expect(supplier.getByRole("link", { name: batch.staffing })).toHaveAttribute("href", `/en/partners/staff-${batch.token}-1`);
    await expect(supplier).toContainText("120 available now, 200 within the timeframe");
    await expect(supplier).toContainText("Philippines: 120 available, 40 per month, available now.");
    await expect(supplier).toContainText(`Confirmed 12 days ago, on ${longDate(daysAgo(12))}.`);
    await expect(section.getByRole("status").filter({ hasText: "supply this" })).toHaveAttribute("aria-live", "polite");
    expect(await results.innerText()).not.toMatch(FORBIDDEN_WORDS);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    const [row] = query<{ kind: string; filters: string }>(
      `select kind, array_to_string(filter_names, ',') as filters from stats.partner_searches order by id desc limit 1`,
    );
    expect(row).toEqual({ kind: "available_workforce", filters: "destination,occupation,capacity,timeframe" });

    await choose(page, section.getByRole("combobox", { name: "Destination" }), "Iceland", /^Iceland$/);
    await section.getByRole("button", { name: "Search available workforce" }).click();
    await expect(section.getByRole("heading", { name: "No partner can supply this within 60 days" })).toBeVisible();
    await expect(section.getByText("Try a longer timeframe or fewer workers.")).toBeVisible();

    try {
      execute(`revoke execute on function ${SEARCH_WORKFORCE} from authenticated`);
      await section.getByRole("button", { name: "Search available workforce" }).click();
      await expect(page.getByRole("region", { name: /Notification/ }).getByText("The available workforce could not be searched")).toBeVisible();
      await expect(section.getByRole("combobox", { name: "Destination" })).toHaveValue("Iceland");
      await expect(section.getByRole("textbox", { name: "Workers needed" })).toHaveValue("100");
    } finally {
      execute(`grant execute on function ${SEARCH_WORKFORCE} to authenticated`);
    }

    await section.getByRole("textbox", { name: "Workers needed" }).fill("0");
    await section.getByRole("button", { name: "Search available workforce" }).click();
    await expect(section.getByText("Enter a number of workers from 1 to 100,000.").first()).toBeVisible();
    await context.close();
  });

  test("FR-K3: Show more partners keeps the list and moves the focus to the first new partner", async ({ browser }) => {
    test.setTimeout(120_000);
    const names = await luxembourgSuppliers(21);
    const { context, page } = await signedIn(browser, await newEmployer());
    await page.goto(DIRECTORY);
    const section = page.getByRole("region", { name: "Available workforce" });
    await waitForHydration(section.getByRole("combobox", { name: "Occupation" }));
    await choose(page, section.getByRole("combobox", { name: "Occupation" }), "welders", /^7212 · Welders and flame cutters$/);
    await choose(page, section.getByRole("combobox", { name: "Destination" }), "Luxembourg", /^Luxembourg$/);
    await section.getByRole("textbox", { name: "Workers needed" }).fill("100");
    await section.getByRole("textbox", { name: "Within (days)" }).fill("60");
    await section.getByRole("button", { name: "Search available workforce" }).click();
    const results = section.getByRole("list", { name: "Partners with available workforce" });
    const headings = results.getByRole("heading", { level: 3 });
    await expect(headings).toHaveCount(20);
    await expect(headings.first()).toHaveText(names[0]);

    // The next page waits on a lock for a moment: the list stays while a small skeleton shows below it.
    const held = executeAsync("begin; lock table public.workforce_availability in access exclusive mode; select pg_sleep(1.5); commit;");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await section.getByRole("button", { name: "Show more partners" }).click();
    await expect(section.getByRole("status", { name: "Loading" })).toBeVisible();
    await expect(headings).toHaveCount(20);
    await held;
    await expect(headings).toHaveCount(21);
    await expect(headings.nth(20)).toHaveText(names[20]);
    await expect(headings.nth(20).getByRole("link")).toBeFocused();
    await expect(section.getByRole("button", { name: "Show more partners" })).toHaveCount(0);
    await context.close();
  });

  test("FR-K3: an employer finds the available workforce search on the recruitment directory too", async ({ page, browser }) => {
    await page.goto("/en/partners/recruitment");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find Recruitment Partners");
    await expect(page.getByRole("region", { name: "Available workforce" })).toHaveCount(0);

    const { context, page: employerPage } = await signedIn(browser, await newEmployer());
    await employerPage.goto("/en/partners/recruitment");
    const section = employerPage.getByRole("region", { name: "Available workforce" });
    await expect(section).toBeVisible();
    await waitForHydration(section.getByRole("combobox", { name: "Occupation" }));
    await expect(employerPage.getByRole("search", { name: "Search recruitment partners" })).toBeVisible();
    await expectAccessibleAtBothWidths(employerPage);
    await context.close();
  });

  test("FR-K3 AC8: an employer whose plan lacks the search is told so", async ({ browser }) => {
    const employer = await newEmployer();
    execute(`update private.settings set value = 'true' where key = 'entitlements_enforced'`);
    try {
      const { context, page } = await signedIn(browser, employer);
      await page.goto(DIRECTORY);
      const section = page.getByRole("region", { name: "Available workforce" });
      await waitForHydration(section.getByRole("combobox", { name: "Occupation" }));
      await choose(page, section.getByRole("combobox", { name: "Occupation" }), "welders", /^7212 · Welders and flame cutters$/);
      await choose(page, section.getByRole("combobox", { name: "Destination" }), "Germany", /^Germany$/);
      await section.getByRole("textbox", { name: "Workers needed" }).fill("100");
      await section.getByRole("textbox", { name: "Within (days)" }).fill("60");
      await section.getByRole("button", { name: "Search available workforce" }).click();
      await expect(section.getByRole("alert").filter({ hasText: "The available workforce search needs a paid employer plan." })).toBeVisible();
      await expect(section.getByRole("list", { name: "Partners with available workforce" })).toHaveCount(0);
      await context.close();
    } finally {
      execute(`update private.settings set value = 'false' where key = 'entitlements_enforced'`);
    }
  });

  test("KPIs: a Platform Administrator reads the staffing and available workforce searches", async ({ page }) => {
    const ids = execute(
      `insert into stats.partner_searches (kind, filter_names, destination_country, result_count)
       values ('staffing', '{destination}', 'IS', 0), ('available_workforce', '{destination,occupation,capacity,timeframe}', 'MT', 0)
       returning id`,
    )
      .trim()
      .split("\n");
    expect(ids).toHaveLength(2);
    try {
      await signInStaff(page, "admin", "/en/admin/statistics");
      const section = page.getByRole("region", { name: "Partner searches" });
      await expect(section.getByRole("region", { name: /^Staffing partner searches from/ })).toContainText("Without results");
      await expect(section.getByRole("region", { name: /^Staffing partner searches without results by destination/ }).getByRole("row", { name: /Iceland/ })).toBeVisible();
      await expect(section.getByRole("region", { name: /^Available workforce searches from/ })).toContainText("With at least one result");
      await expect(section.getByRole("region", { name: /^Available workforce searches without results by destination/ }).getByRole("row", { name: /Malta/ })).toBeVisible();
      await expectAccessibleAtBothWidths(page);
      setPartnerRelease(false);
      expect((await page.request.get(DIRECTORY)).status()).toBe(404);
    } finally {
      setPartnerRelease(true);
      execute(`delete from stats.partner_searches where id in (${ids.join(", ")})`);
    }
  });
});
