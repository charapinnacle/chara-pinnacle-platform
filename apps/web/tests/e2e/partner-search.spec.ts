import type { Page } from "@playwright/test";
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

const DIRECTORY = "/en/partners/recruitment";
const SEARCH_PARTNERS =
  "public.search_partners(text, text, text, text, text[], text, text, public.recruitment_preference, text[], text, integer, integer, text, integer, text, text)";
const FORBIDDEN_WORDS = /\b(verified|approved|licensed|rating|reviews?|score|badge|basic|professional|enterprise|plan)\b/i;
const CONTACT_ACTIONS = /^(Save partner|Follow|Send inquiry|Invite to a requirement)/;

type Batch = { owner: TestUser; token: string; names: string[] };

// Listed recruitment companies serving Germany with occupation 7212 and a listing confirmed three days ago, owned by one
// partner user. Their profile times lie ahead of every other partner of the database, so they come first, in the order
// of their number.
async function listedBatch(count: number): Promise<Batch> {
  const { user } = await partnerWithCompany("recruitment_company");
  const token = uniqueToken();
  execute(
    `with created as (
       insert into public.organizations (type, slug, legal_name, display_name, based_in_country)
       select 'recruitment_company', 'search-' || ${literal(token)} || '-' || n, 'Search Legal ' || ${literal(token)} || ' ' || n || ' Inc.',
         'Search Partner ' || ${literal(token)} || ' ' || lpad(n::text, 2, '0'), 'PH'
       from generate_series(1, ${count}) n
       returning id, slug
     ), members as (
       insert into public.organization_members (organization_id, user_id, role, accepted_at)
       select id, ${literal(user.id)}, 'owner', now() from created
     ), geographies as (
       insert into public.organization_geographies (organization_id, scope, country_code)
       select id, s.scope::public.geography_scope, s.code from created
       cross join (values ('serves_market', 'DE'), ('sources_from', 'PH')) s (scope, code)
     )
     insert into public.organization_occupations (organization_id, occupation_id) select id, '7212' from created;
     update public.organizations set review_status = 'listed', listed_at = now() - interval '2 days',
       submitted_at = now() - interval '3 days',
       workforce_profile_updated_at = now() + interval '1 day' - make_interval(mins => split_part(slug, '-', 3)::integer)
     where slug like ${literal(`search-${token}-%`)};
     insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
       available_from, confirmed_at)
     select id, '7212', 'PH', 40, 15, current_date + 14, now() - interval '3 days'
     from public.organizations where slug like ${literal(`search-${token}-%`)}`,
  );
  const names = Array.from({ length: count }, (_, index) => `Search Partner ${token} ${String(index + 1).padStart(2, "0")}`);
  return { owner: user, token, names };
}

// The date as the pages write it (lib/i18n/format.ts formatDate), in UTC.
const longDate = (date: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(date);

const cards = (page: Page) => page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });

async function signedIn(browser: import("@playwright/test").Browser, user: TestUser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": visitorAddress() } });
  const page = await context.newPage();
  await logIn(page, user);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  return { context, page };
}

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// partner profile spec (playwright.config.ts), and the tests run one after the other.
test.describe("Find recruitment partners (FR-L1)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("AC8, AC4: a visitor filters by destination and occupation, pages, goes back and shares the address", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const batch = await listedBatch(22);
    await page.goto(DIRECTORY);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find Recruitment Partners");
    const destination = page.getByRole("combobox", { name: "Destination country" });
    await waitForHydration(destination);
    await destination.fill("Germany");
    await page.getByRole("option", { name: "Germany", exact: true }).click();
    await page.getByRole("combobox", { name: "Occupation", exact: true }).fill("welders");
    await page.getByRole("option", { name: /^7212 · Welders and flame cutters$/ }).click();
    await page.getByRole("button", { name: "Search partners" }).click();

    await expect(page).toHaveURL(`${DIRECTORY}?destination=DE&occupation=7212`);
    await expect(page.getByRole("status").filter({ hasText: "shown" })).toHaveText("20 recruitment partners shown, more on the next page");
    await expect(cards(page)).toHaveCount(20);
    const first = cards(page).first();
    await expect(first.getByRole("heading", { level: 2 })).toHaveText(batch.names[0]);
    await expect(first.getByRole("link", { name: batch.names[0], exact: true })).toHaveAttribute("href", `/en/partners/search-${batch.token}-1`);
    await expect(first).toContainText("Based in Philippines");
    await expect(first).toContainText("Recruits for Germany");
    await expect(first).toContainText("Main occupations: Welders and flame cutters");
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await expect(first).toContainText(`Capacity confirmed ${longDate(threeDaysAgo)}`);
    await expect(first).toContainText("Matches: destination, occupation");
    expect(await page.getByRole("main").getByRole("list").first().innerText()).not.toMatch(FORBIDDEN_WORDS);
    const html = await page.content();
    expect(html).not.toContain(`Search Legal ${batch.token}`);
    expect(html).not.toContain(batch.owner.email);

    await page.getByRole("link", { name: "Show more partners" }).click();
    await expect(page).toHaveURL(/[?&]cursor=/);
    const secondPage = page.url();
    expect(new URL(secondPage).searchParams.get("destination")).toBe("DE");
    await expect(cards(page).nth(0).getByRole("heading", { level: 2 })).toHaveText(batch.names[20]);
    await expect(cards(page).nth(1).getByRole("heading", { level: 2 })).toHaveText(batch.names[21]);
    await expect(page.getByRole("link", { name: "Back to the first page" })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(`${DIRECTORY}?destination=DE&occupation=7212`);
    await expect(cards(page).first().getByRole("heading", { level: 2 })).toHaveText(batch.names[0]);
    await expect(page.getByRole("combobox", { name: "Destination country" })).toHaveValue("Germany");

    const shared = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": visitorAddress() } });
    const sharedPage = await shared.newPage();
    await sharedPage.goto(secondPage);
    await expect(cards(sharedPage).nth(0).getByRole("heading", { level: 2 })).toHaveText(batch.names[20]);
    await expect(cards(sharedPage).nth(1).getByRole("heading", { level: 2 })).toHaveText(batch.names[21]);
    await shared.close();

    const head = await readHead(page);
    expect(head.canonical).toBe(`${SITE}${DIRECTORY}`);
    await expectAccessibleAtBothWidths(page);
  });

  test("AC9: the actions depend on the viewer", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const batch = await listedBatch(1);
    const address = `${DIRECTORY}?destination=DE&occupation=7212`;
    await page.goto(address);
    const card = cards(page).filter({ hasText: batch.names[0] });
    const contact = card.getByRole("link", { name: `Sign up to contact ${batch.names[0]}` });
    await expect(contact).toHaveAttribute("href", "/en/signup?kind=company");
    let reached = false;
    for (let step = 0; step < 80 && !reached; step++) {
      await page.keyboard.press("Tab");
      reached = await contact.evaluate((element) => element === document.activeElement);
    }
    expect(reached, "Sign up to contact is reachable by Tab").toBe(true);

    const employer = await createCommittedUser("company");
    await registerOrganization(employer, `${uniqueName("Partner Searcher")} GmbH`);
    const viewers: [string, TestUser][] = [
      ["candidate", await createCommittedUser("worker")],
      ["partner member", batch.owner],
      ["employer admin", employer],
    ];
    for (const [label, user] of viewers) {
      const { context, page: viewerPage } = await signedIn(browser, user);
      await viewerPage.goto(address);
      const viewerCard = cards(viewerPage).filter({ hasText: batch.names[0] });
      await expect(viewerCard, label).toHaveCount(1);
      await expect(viewerCard.getByRole("link", { name: /Sign up to contact/ }), label).toHaveCount(0);
      // Save partner and Follow (FR-L4, V24): employers save and follow, candidates follow, the partner's own member neither.
      const actions: Record<string, string[]> = { candidate: ["Follow"], "partner member": [], "employer admin": ["Save partner", "Follow"] };
      const expected = actions[label] ?? [];
      await expect(viewerCard.getByRole("button", { name: CONTACT_ACTIONS }), label).toHaveCount(expected.length);
      for (const action of expected) {
        await expect(viewerCard.getByRole("button", { name: `${action}: ${batch.names[0]}` }), label).toHaveAttribute("aria-pressed", "false");
      }
      await context.close();
    }
  });

  test("AC5: advanced filters outside the plan say so and offer the search without them", async ({ page }) => {
    await page.goto(`${DIRECTORY}?destination=DE&capacity=100&within_days=60`);
    await expect(page.getByText("These filters need a plan with advanced partner search.")).toBeVisible();
    await expect(page.getByRole("group", { name: "Workforce capacity" })).toBeVisible();
    await page.getByRole("link", { name: "Search without them" }).click();
    await expect(page).toHaveURL(`${DIRECTORY}?destination=DE`);
    await expect(page.getByRole("status").filter({ hasText: "shown" })).toBeVisible();
  });

  test("AC10: the empty state, the skeleton, the keyboard and the 360 px layout", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`${DIRECTORY}?destination=XX&occupation=7212&utm_source=mail`);
    const empty = page.getByRole("heading", { name: "No recruitment partners match your search" });
    await expect(empty).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", DIRECTORY);
    await expect(page.getByRole("link", { name: "Find Staffing Partners" })).toHaveAttribute("href", "/en/partners/staffing");
    for (const label of ["Destination country", "Occupation", "Based in", "Industry", "Language"]) {
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
    await page.keyboard.press("Tab");
    await page.keyboard.type("Welders");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Enter");
    const button = page.getByRole("button", { name: "Search partners" });
    for (let step = 0; step < 5; step++) {
      if (await button.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${DIRECTORY}?destination=DE&occupation=7212`);
    await expect(page.getByRole("status").filter({ hasText: "shown" })).toHaveAttribute("aria-live", "polite");

    // The lock is held for less than the 3 s statement timeout of anon, so the search waits instead of failing.
    const held = executeAsync("begin; lock table public.organization_geographies in access exclusive mode; select pg_sleep(2); commit;");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.goto(`${DIRECTORY}?destination=DE`, { waitUntil: "commit" });
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "shown" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
    await held;
  });

  test("AC10: a failed search shows a toast and Try again, and retrying shows the results", async ({ page }) => {
    try {
      execute(`revoke execute on function ${SEARCH_PARTNERS} from anon, authenticated`);
      await page.goto(`${DIRECTORY}?destination=DE`);
      await expect(page.getByRole("heading", { name: "The recruitment partners could not be loaded" })).toBeVisible();
      await expect(page.getByRole("region", { name: /Notification/ }).getByText("The recruitment partners could not be loaded")).toBeVisible();
      await expect(page.getByText("permission denied")).toHaveCount(0);
    } finally {
      execute(`grant execute on function ${SEARCH_PARTNERS} to anon, authenticated`);
    }
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Find Recruitment Partners" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "shown" })).toBeVisible();
  });

  test("AC11: over the visitor limit the page says so, and every first page is logged without personal data", async ({ page }) => {
    const before = Number(query<{ n: string }>("select count(*) as n from stats.partner_searches")[0].n);
    await page.goto(`${DIRECTORY}?destination=DE&language=tl`);
    await expect(page.getByRole("status").filter({ hasText: "shown" })).toBeVisible();
    const [row] = query<{ kind: string; filters: string; destination: string }>(
      `select kind, array_to_string(filter_names, ',') as filters, destination_country as destination
       from stats.partner_searches order by id desc limit 1`,
    );
    expect(row).toEqual({ kind: "recruitment", filters: "destination,language", destination: "DE" });
    expect(Number(query<{ n: string }>("select count(*) as n from stats.partner_searches")[0].n)).toBe(before + 1);

    execute(`update private.settings set value = '1' where key = 'rate_limit_partner_search_max'`);
    try {
      await page.goto(`${DIRECTORY}?destination=DE`);
      await expect(page.getByText("Too many searches. Please wait a minute and try again.")).toBeVisible();
      await expect(cards(page)).toHaveCount(0);
    } finally {
      execute(`update private.settings set value = '60' where key = 'rate_limit_partner_search_max'`);
    }
  });

  test("KPIs: a Platform Administrator reads the partner searches on the statistics page", async ({ page }) => {
    const ids = execute(
      `insert into stats.partner_searches (kind, filter_names, destination_country, result_count)
       values ('recruitment', '{destination}', 'IS', 0), ('recruitment', '{destination}', 'IS', 0) returning id`,
    )
      .trim()
      .split("\n");
    expect(ids).toHaveLength(2);
    try {
      await signInStaff(page, "admin", "/en/admin/statistics");
      const section = page.getByRole("region", { name: "Partner searches" });
      await expect(section.getByRole("heading", { name: "Partner searches" })).toBeVisible();
      await expect(section.getByRole("region", { name: /^Recruitment partner searches from/ })).toContainText("Without results");
      const destinations = section.getByRole("region", { name: /^Recruitment partner searches without results by destination/ });
      await expect(destinations.getByRole("row", { name: /Iceland/ })).toBeVisible();
      await expectAccessibleAtBothWidths(page);
      setPartnerRelease(false);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Partner searches" })).toHaveCount(0);
      expect((await page.request.get(DIRECTORY)).status()).toBe(404);
    } finally {
      setPartnerRelease(true);
      execute(`delete from stats.partner_searches where id in (${ids.join(", ")})`);
    }
  });
});
