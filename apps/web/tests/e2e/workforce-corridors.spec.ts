import type { Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal } from "./support/db";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { uniqueToken } from "./support/organizations";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { readHead, SITE } from "./support/seo";
import { expect, test } from "./support/test";

// Countries no other spec uses: Nauru and Tuvalu as source countries, Liechtenstein as the destination.
const LISTED = "/en/corridors/nr-li";
const BELOW_K = "/en/corridors/tv-li";
const NETWORK = "/en/network/li";

function setCorridorRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_corridors'`);
}

// Six listed recruitment companies sourcing from Nauru for Liechtenstein (manufacturing, welders), five with a fresh
// listing of 20 welders; three listed staffing companies based in and sourcing from Tuvalu for Liechtenstein. Partners
// that earlier runs left serving Liechtenstein are hidden first, then the snapshots are refreshed as the job does.
async function seedCorridors(): Promise<void> {
  const { user } = await partnerWithCompany("recruitment_company");
  const token = uniqueToken();
  execute(
    `update public.organizations set moderation_state = 'hidden'
     where id in (select organization_id from public.organization_geographies where scope = 'serves_market' and country_code = 'LI');
     with created as (
       insert into public.organizations (type, slug, legal_name, display_name, based_in_country)
       select case when n <= 6 then 'recruitment_company' else 'staffing_company' end::public.organization_type,
         'cor-' || ${literal(token)} || '-' || n, 'Corridor Legal ' || ${literal(token)} || ' ' || n,
         'Corridor Partner ' || ${literal(token)} || ' ' || n, case when n <= 6 then 'NR' else 'TV' end
       from generate_series(1, 9) n
       returning id, type, based_in_country
     ), members as (
       insert into public.organization_members (organization_id, user_id, role, accepted_at)
       select id, ${literal(user.id)}, 'owner', now() from created
     ), geographies as (
       insert into public.organization_geographies (organization_id, scope, country_code)
       select id, 'sources_from'::public.geography_scope, based_in_country from created
       union all select id, 'serves_market', 'LI' from created
     ), industries as (
       insert into public.organization_industries (organization_id, industry_code) select id, 'C' from created
     )
     insert into public.organization_occupations (organization_id, occupation_id) select id, '7212' from created;
     update public.organizations set review_status = 'listed', listed_at = now() - interval '2 days',
       submitted_at = now() - interval '3 days'
     where slug like ${literal(`cor-${token}-%`)};
     insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
       available_from, confirmed_at)
     select id, '7212', 'NR', 20, 5, current_date, now() - interval '1 day'
     from public.organizations where slug in (select 'cor-' || ${literal(token)} || '-' || n from generate_series(1, 5) n);
     select private.refresh_corridor_statistics();`,
  );
}

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Menu" });
  await expect(panel).toBeVisible();
  return panel;
}

// The release switches are set for the whole database while this file runs, so it is a project of its own that follows
// the release projects (playwright.config.ts), and the tests run one after the other.
test.describe("Workforce corridors and the network view (brief sections 18 to 20)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async () => {
    setPartnerRelease(true);
    setCorridorRelease(true);
    await seedCorridors();
  });
  test.afterAll(() => {
    setCorridorRelease(false);
    setPartnerRelease(false);
  });

  test("the Menu links Workforce corridors once released, and no longer names it as coming later", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/en/about");
    const panel = await openMenu(page);
    const link = panel.getByRole("navigation", { name: "Explore" }).getByRole("link", { name: "Workforce corridors" });
    await expect(link).toHaveAttribute("href", "/en/corridors");
    await expect(panel.getByRole("list", { name: "Coming in a later phase" }).getByText("Workforce corridors")).toHaveCount(0);
    await link.click();
    await expect(page).toHaveURL("/en/corridors");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Workforce corridors");
  });

  test("the index lists the corridor with enough partners as a card, filters by destination, and hides the one below k", async ({ page }) => {
    await page.goto("/en/corridors");
    const corridors = page.getByRole("list", { name: "Corridors" });
    const card = corridors.getByRole("listitem").filter({ hasText: "Nauru" });
    await expect(card.getByRole("link", { name: "Nauru to Liechtenstein" })).toHaveAttribute("href", LISTED);
    await expect(card.getByRole("link", { name: "Sign in to see available workers" })).toHaveAttribute(
      "href",
      `/en/login?next=${encodeURIComponent("/en/corridors")}`,
    );
    await expect(card).not.toContainText("100–249");
    await expect(card).toContainText("Recruitment partners6");
    await expect(card).toContainText("Staffing partnersFewer than 5");
    await expect(corridors.getByText("Tuvalu")).toHaveCount(0);

    await page.getByLabel("Destination country").selectOption("LI");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL("/en/corridors?destination=LI&source=");
    await expect(corridors.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "See the workforce network for Liechtenstein" })).toHaveAttribute("href", NETWORK);
    await expectAccessibleAtBothWidths(page);

    const head = await readHead(page);
    expect(head.title).toBe("Workforce corridors — Chara Pinnacle");
    expect(head.canonical).toBe(`${SITE}/en/corridors`);
  });

  test("a corridor page shows the figures of the brief and leads into the pre-filtered directories", async ({ page }) => {
    await page.goto("/en/corridors/NR-LI");
    await expect(page).toHaveURL(LISTED);
    await expect(page.getByRole("heading", { level: 1, name: "Nauru to Liechtenstein" })).toBeVisible();
    const figures = page.getByRole("region", { name: "Corridor figures" });
    await expect(figures.getByRole("link", { name: "Sign in to see available workers" })).toHaveAttribute(
      "href",
      `/en/login?next=${encodeURIComponent(LISTED)}`,
    );
    await expect(figures).toContainText("Recruitment partners6");
    await expect(figures).toContainText("Staffing partnersFewer than 5");
    await expect(figures).toContainText("IndustriesManufacturing");
    await expect(page.getByRole("link", { name: "See recruitment partners" })).toHaveAttribute(
      "href",
      "/en/partners/recruitment?destination=LI&sources_from=NR",
    );
    await expect(page.getByRole("link", { name: "See staffing partners" })).toHaveAttribute("href", "/en/partners/staffing?destination=LI");
    await expect(page.getByRole("link", { name: "Read the disclaimer" })).toHaveAttribute("href", "/en/legal/immigration-disclaimer");
    await expect(page.getByText(/Corridor Partner/)).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    expect((await readHead(page)).canonical).toBe(`${SITE}${LISTED}`);

    await page.getByRole("link", { name: "See recruitment partners" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find recruitment partners");
  });

  test("P26: a signed-in user sees the workers available as a range on the index, the corridor and the network, a visitor never", async ({ page }) => {
    const user = await createCommittedUser("company");
    await logIn(page, user);
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    await page.goto(LISTED);
    const figures = page.getByRole("region", { name: "Corridor figures" });
    await expect(figures).toContainText("Workers available100–249");
    await expect(page.getByRole("link", { name: "Sign in to see available workers" })).toHaveCount(0);
    await page.goto("/en/corridors");
    await expect(page.getByRole("list", { name: "Corridors" }).getByRole("listitem").filter({ hasText: "Nauru" })).toContainText("100–249");
    await page.goto(NETWORK);
    await expect(page.getByRole("region", { name: "Manufacturing" })).toContainText("Workers available100–249");

    await page.context().clearCookies({ name: /^sb-/ });
    await page.goto(LISTED);
    await expect(figures.getByRole("link", { name: "Sign in to see available workers" })).toBeVisible();
    await expect(figures).not.toContainText("100–249");
  });

  test("a corridor below k keeps its page in the suppressed form, out of the index of search engines; a non-corridor is not found", async ({ page }) => {
    await page.goto(BELOW_K);
    await expect(page.getByText("Fewer than 5 listed partners work in this corridor, so its figures are not shown yet.")).toBeVisible();
    await expect(page.getByText("Staffing partners", { exact: true })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expectAccessibleAtBothWidths(page);
    for (const path of ["/en/corridors/li-li", "/en/corridors/zz-li", "/en/corridors/nauru-li"]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });

  test("the network page shows the industry and occupation with the recruitment network by source country", async ({ page }) => {
    await page.goto(NETWORK);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Workforce network for Liechtenstein");
    const industry = page.getByRole("region", { name: "Manufacturing" });
    await expect(industry).toContainText("Recruitment partners6");
    const occupation = industry.getByRole("listitem").filter({ hasText: "Welders and flame cutters" }).first();
    await expect(occupation).toContainText("Recruitment companies by the country they source workers from");
    await expect(occupation).toContainText("Nauru: 6 companies");
    await expect(occupation).toContainText("Staffing companies by the country they are based in");
    await expect(industry.getByRole("link", { name: "Sign in to see available workers" }).first()).toHaveAttribute(
      "href",
      `/en/login?next=${encodeURIComponent(NETWORK)}`,
    );
    await expect(occupation).toContainText("No country with 5 or more companies yet");
    await expect(page.getByText("An interactive map of the network comes later.", { exact: false })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.goto("/en/network/LI");
    await expect(page).toHaveURL(NETWORK);
  });

  test("the sitemap lists the index and the listed corridor, never the one below k", async ({ request }) => {
    const body = await (await request.get("/sitemap.xml")).text();
    expect(body).toContain(`<loc>${SITE}/en/corridors</loc>`);
    expect(body).toContain(`<loc>${SITE}${LISTED}</loc>`);
    expect(body).not.toContain(`${SITE}${BELOW_K}`);
  });

  test("while release_corridors is off every page is not found and the Menu names the corridors as coming later", async ({ page }) => {
    setCorridorRelease(false);
    try {
      for (const path of ["/en/corridors", LISTED, NETWORK]) expect((await page.goto(path))?.status(), path).toBe(404);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto("/en/about");
      const panel = await openMenu(page);
      await expect(panel.getByRole("list", { name: "Coming in a later phase" }).getByText("Workforce corridors")).toBeVisible();
    } finally {
      setCorridorRelease(true);
    }
  });
});
