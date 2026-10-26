import type { Locator, Page } from "@playwright/test";
import { signInStaff, uniqueTag } from "./support/admin";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { newOwner, staffUser } from "./support/mfa";
import { createCommittedPartner, setPartnerRelease } from "./support/partners";
import { captureActionRequests } from "./support/server-action";
import { expect, test } from "./support/test";

const STATISTICS = "/en/admin/statistics";
const FUNCTION = "public.admin_network_counts(date, date, text)";
// March and April 2025 lie before any other partner organisation of the test database, so the counts are those seeded here.
const MARCH = "2025-03-01";
const APRIL_END = "2025-04-30";

type Seed = { tag: string; ownerId: string };

// The data of FR-S2 AC1 for release 2a: 12 recruitment companies created in March (9 listed, 2 waiting for review, 1
// suspended) and 7 staffing companies, all listed; the states at the end of March and April as the daily job writes them;
// 240 recruitment searches in March and 60 in April.
async function seedNetwork(): Promise<Seed> {
  const tag = uniqueTag();
  const owner = await createCommittedPartner("recruitment_company");
  execute(
    `with created as (
       insert into public.organizations (type, slug, legal_name, display_name, based_in_country, review_status)
       select case when n <= 12 then 'recruitment_company' else 'staffing_company' end::public.organization_type,
         'netstat-${tag}-' || n, 'Netstat ${tag} ' || n || ' Ltd', 'Netstat ${tag} ' || n, 'PH',
         case when n between 11 and 12 then 'pending_review' else 'listed' end::public.partner_review_status
       from generate_series(1, 19) n
       returning id
     )
     insert into public.organization_members (organization_id, user_id, role, accepted_at)
     select id, ${literal(owner.id)}, 'owner', now() from created;
     update public.organizations
     set created_at = '2025-03-03 10:00+00'::timestamptz + make_interval(days => split_part(slug, '-', 3)::integer),
       listed_at = case when review_status = 'listed' then '2025-03-25 10:00+00'::timestamptz end,
       status = case when slug = 'netstat-${tag}-10' then 'suspended' else 'active' end::public.organization_status
     where slug like 'netstat-${tag}-%';
     insert into stats.partner_status_daily (day, organization_type, status_key, count)
     select d, t, k, case
         when t = 'recruitment_company' and k = 'listed' then 9 when t = 'recruitment_company' and k = 'pending_review' then 2
         when t = 'recruitment_company' and k = 'active' then 11 when t = 'recruitment_company' and k = 'suspended' then 1
         when t = 'staffing_company' and k in ('listed', 'active') then 7 else 0 end
     from unnest(array['2025-03-31', '2025-04-30']::date[]) d,
       unnest(array['recruitment_company', 'staffing_company']::public.organization_type[]) t,
       unnest(array['onboarding', 'pending_review', 'info_requested', 're_review', 'listed', 'declined', 'active', 'suspended']) k
     on conflict (day, organization_type, status_key) do update set count = excluded.count;
     insert into stats.partner_searches (kind, filter_names, destination_country, result_count, created_at)
     select 'recruitment', '{destination}', 'DE', 1, case when n <= 240
       then '2025-03-01 00:00+00'::timestamptz + make_interval(mins => n * 150)
       else '2025-04-01 00:00+00'::timestamptz + make_interval(mins => (n - 240) * 600) end
     from generate_series(1, 300) n`,
  );
  return { tag, ownerId: owner.id };
}

function removeNetwork(seed: Seed): void {
  execute(
    `delete from stats.partner_status_daily where day in ('2025-03-31', '2025-04-30');
     delete from stats.partner_searches where created_at >= '2025-03-01' and created_at < '2025-05-01';
     delete from public.organizations where slug like 'netstat-${seed.tag}-%'`,
  );
}

function section(page: Page): Locator {
  return page.getByRole("region", { name: "Partner network" });
}

function metricTable(page: Page, name: string): Locator {
  return section(page).getByRole("region", { name, exact: true });
}

async function showRange(page: Page, from: string, to: string, period = "Month"): Promise<void> {
  const network = section(page);
  const fromField = network.getByLabel("From", { exact: true });
  await waitForHydration(fromField);
  await fromField.fill(from);
  await network.getByLabel("To", { exact: true }).fill(to);
  await network.getByLabel("Period", { exact: true }).selectOption({ label: period });
  await network.getByRole("button", { name: "Show" }).click();
}

// Release 2a is switched on for the whole database and the count function is withdrawn for a moment, so this file is a
// project of its own after the partner dashboards (playwright.config.ts), and its tests run one after the other.
test.describe("Network statistics for administrators (FR-S2, release 2a)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => {
    execute(`grant execute on function ${FUNCTION} to authenticated`);
    setPartnerRelease(false);
  });

  test("FR-S2 AC7: a Platform Administrator reads the partner network of March and April by month, with trends and no names", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedNetwork();
    try {
      await signInStaff(page, "admin", STATISTICS);
      await expect(section(page).getByRole("heading", { name: "Partner network", level: 2 })).toBeVisible();
      await expect(section(page).getByRole("region", { name: /^Key figures from / })).toBeVisible();
      await showRange(page, MARCH, APRIL_END);

      const fresh = metricTable(page, "Recruitment companies: New sign-ups");
      await expect(fresh.getByRole("row", { name: /March 2025/ })).toContainText("12");
      await expect(fresh.getByRole("row", { name: /April 2025/ })).toContainText("fewer than 5");
      const listed = metricTable(page, "Recruitment companies: Listed at the end of the period");
      await expect(listed.getByRole("row", { name: /March 2025/ })).toContainText("9");
      await expect(listed.getByRole("row", { name: /April 2025/ })).toContainText("no change from 9");
      await expect(metricTable(page, "Recruitment companies: Waiting for review at the end of the period").getByRole("row", { name: /March 2025/ }))
        .toContainText("fewer than 5");
      await expect(metricTable(page, "Staffing companies: Listed at the end of the period").getByRole("row", { name: /March 2025/ }))
        .toContainText("7");
      const searches = metricTable(page, "Searches, saves and follows: Recruitment partner searches");
      await expect(searches.getByRole("row", { name: /March 2025/ })).toContainText("240");
      await expect(searches.getByRole("row", { name: /April 2025/ })).toContainText("down from 240");
      await expect(section(page).getByRole("region", { name: `Key figures from ${MARCH} to ${APRIL_END}` })).toContainText(
        "Saves and follows of partners per 100 partner searches",
      );
      await expect(section(page).getByText("Whole periods from 1 March 2025 to 30 April 2025.")).toBeVisible();
      await expect(section(page).getByText(/States recorded from 31 March 2025/)).toBeVisible();
      await expect(page.getByText(`Netstat ${seed.tag}`)).toHaveCount(0);
      await expect(section(page).getByText("No partner network activity in this period")).toHaveCount(0);
      await expectAccessibleAtBothWidths(page);
    } finally {
      removeNetwork(seed);
    }
  });

  test("FR-S2 AC9: a skeleton while loading, the empty note, a field error without a request and a retry after a failure", async ({ page }) => {
    test.setTimeout(120_000);
    await signInStaff(page, "admin", STATISTICS);
    const network = section(page);
    await waitForHydration(network.getByLabel("From", { exact: true }));
    const calls = captureActionRequests(page);

    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${STATISTICS}`, async (route) => {
      if (!route.request().headers()["next-action"]) return route.continue();
      await held;
      return route.continue();
    });
    await showRange(page, "2024-01-01", "2024-01-31");
    await expect(network.getByRole("status", { name: "Loading" })).toBeVisible();
    release();
    await expect(network.getByText("No partner network activity in this period")).toBeVisible();
    await expect(metricTable(page, "Recruitment companies: New sign-ups").getByRole("row", { name: /January 2024/ })).toContainText("fewer than 5");
    // January 2024 ends before the first daily state, so its states are unknown, not hidden.
    const state = metricTable(page, "Recruitment companies: Listed at the end of the period").getByRole("row", { name: /January 2024/ });
    await expect(state.getByRole("cell").first()).toHaveText("-");
    await page.unroute(`**${STATISTICS}`);
    await expectAccessibleAtBothWidths(page);

    const before = calls.length;
    await showRange(page, "2024-02-01", "2024-01-31");
    const from = network.getByLabel("From", { exact: true });
    await expect(from).toHaveAttribute("aria-invalid", "true");
    await expect(network.getByText("The start date must not be after the end date")).toBeVisible();
    expect(calls.length).toBe(before);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await showRange(page, new Date().toISOString().slice(0, 10), tomorrow);
    await expect(network.getByLabel("To", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(network.getByText("The end date must not be after today")).toBeVisible();
    expect(calls.length).toBe(before);

    execute(`revoke execute on function ${FUNCTION} from authenticated`);
    try {
      await showRange(page, "2024-01-01", "2024-01-31");
      await expect(network.getByRole("heading", { name: "The partner network statistics could not be loaded" })).toBeVisible();
      await expect(page.getByText("Check your connection and try again.")).toBeVisible();
      await expectAccessibleAtBothWidths(page);
    } finally {
      execute(`grant execute on function ${FUNCTION} to authenticated`);
    }
    await network.getByRole("button", { name: "Try again" }).click();
    await expect(network.getByText("No partner network activity in this period")).toBeVisible();
  });

  test("FR-S2 AC8: a Trust & Safety Administrator and an employer owner get not found, an administrator at aal1 is sent to two-step verification", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInStaff(page, "trust_safety", "/en/admin");
    const refused = await page.goto(STATISTICS);
    expect(refused?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Partner network" })).toHaveCount(0);
    await page.context().clearCookies();

    await logIn(page, await staffUser("admin"));
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto(STATISTICS);
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent(STATISTICS)}`);
    await page.context().clearCookies();

    await logIn(page, await newOwner());
    await expect(page).not.toHaveURL(/\/en\/login/);
    const owner = await page.goto(STATISTICS);
    expect(owner?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Partner network" })).toHaveCount(0);
    await page.context().clearCookies();

    await logIn(page, await createCommittedUser("worker"));
    await expect(page).not.toHaveURL(/\/en\/login/);
    expect((await page.goto(STATISTICS))?.status()).toBe(404);
  });

  test("release 2a off: the statistics page has no Partner network section", async ({ page }) => {
    await signInStaff(page, "admin", STATISTICS);
    await expect(page.getByRole("heading", { name: "Partner network" })).toBeVisible();
    setPartnerRelease(false);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Statistics", level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Partner network" })).toHaveCount(0);
    } finally {
      setPartnerRelease(true);
    }
  });
});
