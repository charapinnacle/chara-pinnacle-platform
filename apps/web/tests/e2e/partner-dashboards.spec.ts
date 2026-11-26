import type { Browser, Locator, Page, Request } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, executeAsync, literal, query } from "./support/db";
import { newCompany } from "./support/jobs";
import { createCommittedUser, enrollTotp } from "./support/login";
import { createCommittedPartner, partnerWithCompany, setPartnerRelease, type PartnerType } from "./support/partners";
import { signInBrowser } from "./support/session";
import { signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";
import type { TestUser } from "./support/test-user";

type Partner = { user: TestUser; id: string; slug: string };

const RECRUITMENT_QUESTION = "Which employers need workers I can recruit?";
const STAFFING_QUESTION = "Which employers need the workforce I can provide?";
const FUNCTION = "public.get_partner_dashboard(uuid)";
const dashboardUrl = (segment: string, slug?: string) => (slug ? `/en/dashboard/${segment}?org=${slug}` : `/en/dashboard/${segment}`);

// A partner that was approved and listed, with the profile its listings draw on (welders and plumbers from the
// Philippines, serving Germany).
async function listedPartner(type: PartnerType): Promise<Partner> {
  const partner = await partnerWithCompany(type);
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code)
     values (${literal(partner.id)}, 'sources_from', 'PH'), (${literal(partner.id)}, 'serves_market', 'DE');
     insert into public.organization_occupations (organization_id, occupation_id)
     values (${literal(partner.id)}, '7212'), (${literal(partner.id)}, '7126'), (${literal(partner.id)}, '9329');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day',
       submitted_at = now() - interval '2 days' where id = ${literal(partner.id)}`,
  );
  return partner;
}

function seedListing(organizationId: string, occupation: string, confirmedDaysAgo: number, available = 25): void {
  execute(
    `insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
       available_from, confirmed_at)
     values (${literal(organizationId)}, ${literal(occupation)}, 'PH', ${available}, 5, current_date + 10,
       now() - make_interval(days => ${confirmedDaysAgo}))`,
  );
}

async function joinPartner(partner: Partner, role: "admin" | "member", user?: TestUser): Promise<TestUser> {
  const member = user ?? (await createCommittedUser("company"));
  execute(
    `insert into public.organization_members (organization_id, user_id, role, accepted_at, invited_by)
     values (${literal(partner.id)}, ${literal(member.id)}, ${literal(role)}, now(), ${literal(partner.user.id)})`,
  );
  return member;
}

// The dashboard asks no code (its figures hold no candidate data), so the admin answers the challenge of the billing
// page first, as owners and admins do on every organisation page, and the session is at aal2.
async function signInAdmin(page: Page, user: TestUser, secret: string, slug: string, segment: string): Promise<void> {
  await signInAtAal2(page, user, secret, `/en/org/${slug}/billing`);
  await page.goto(dashboardUrl(segment, slug));
}

async function signedIn(browser: Browser, user: TestUser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  await signInBrowser(context, user);
  return { page: await context.newPage(), close: () => context.close() };
}

// Tabs from the top of the page until the control has the focus: it is reachable by keyboard, in page order.
async function tabTo(page: Page, control: Locator): Promise<number> {
  await page.locator("body").focus();
  for (let presses = 1; presses <= 80; presses += 1) {
    await page.keyboard.press("Tab");
    if (await control.evaluate((element) => element === document.activeElement)) return presses;
  }
  throw new Error(`Tab never reached ${control}`);
}

async function expectFocusVisible(control: Locator): Promise<void> {
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  const outline = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return `${style.outlineStyle} ${style.boxShadow}`;
  });
  expect(outline).not.toBe("none none");
}

const listingRow = (page: Page, name: string) =>
  page.getByRole("list", { name: "Available workforce listings" }).getByRole("listitem").filter({ hasText: name });

// The release switch is set for the whole database and the dashboard function is withdrawn for a moment, so this file
// is a project of its own after the data export spec (playwright.config.ts), and its tests run one after the other.
test.describe("Partner dashboards (FR-R3, FR-R4, release 2a)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => {
    execute(`grant execute on function ${FUNCTION} to authenticated`);
    setPartnerRelease(false);
  });

  test("FR-R3 AC1, AC8, AC9: the recruitment dashboard of an admin at aal2 and of a member", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const r = await listedPartner("recruitment_company");
    seedListing(r.id, "7212", 2);
    seedListing(r.id, "7126", 59);
    seedListing(r.id, "9329", 61);
    execute(
      `insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at)
       values (${literal(r.id)}, 'recruitment_partner', 'trialing', 'null', now() + interval '20 days')`,
    );
    const admin = await joinPartner(r, "admin", await createCommittedPartner("recruitment_company"));
    const member = await joinPartner(r, "member", await createCommittedPartner("recruitment_company"));
    const secret = await enrollTotp(admin);
    await signInAdmin(page, admin, secret, r.slug, "recruitment");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(RECRUITMENT_QUESTION);
    const capacity = page.getByRole("main").getByRole("link", { name: "Update recruiting capacity" });
    await expect(capacity).toHaveAttribute("href", `/en/org/${r.slug}/workforce-profile#availability-heading`);
    await tabTo(page, capacity);
    await expectFocusVisible(capacity);
    // AC6: the actions of job orders and submissions are absent while their releases are off.
    for (const absent of ["Find job orders", "Submit candidates", "Find employers"]) {
      await expect(page.getByRole("link", { name: absent })).toHaveCount(0);
    }

    // AC8: three listings with their confirmation, the 61-day one warned in words, Confirm for the owner and admins.
    const rows = page.getByRole("list", { name: "Available workforce listings" }).getByRole("listitem");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Confirmed 61 days ago, on");
    await expect(rows.filter({ hasText: "Not confirmed for 60 days or more" })).toHaveCount(1);
    await expect(rows.nth(0)).toContainText("Not confirmed for 60 days or more");
    await expect(rows.nth(2)).toContainText("Confirmed 2 days ago, on");
    await expect(rows.getByRole("button", { name: /^Confirm/ })).toHaveCount(2);

    // AC9: the plan, its free month and the usage of org_usage, with Manage plan for the admin.
    const plan = page.getByRole("region", { name: "Plan and usage" });
    await expect(plan).toContainText("Basic");
    await expect(plan).toContainText("Free month ends");
    await expect(plan).toContainText("1 of 3 countries served");
    await expect(plan).toContainText("3 of 10 workforce listings");
    await expect(plan.getByRole("link", { name: "Manage plan" })).toHaveAttribute("href", `/en/org/${r.slug}/billing`);
    await expect(page.getByRole("region", { name: "Next actions" })).toContainText("Confirm 1 listing hidden from search");
    await expectAccessibleAtBothWidths(page);

    // The member reads every block, without the actions of the owner and admins.
    const reader = await signedIn(browser, member);
    await reader.page.goto(dashboardUrl("recruitment", r.slug));
    await expect(reader.page.getByRole("heading", { level: 1 })).toHaveText(RECRUITMENT_QUESTION);
    await expect(listingRow(reader.page, "Not confirmed for 60 days or more")).toHaveCount(1);
    await expect(reader.page.getByRole("button", { name: /^Confirm/ })).toHaveCount(0);
    await expect(reader.page.getByRole("link", { name: "Update recruiting capacity" })).toHaveCount(0);
    const readerPlan = reader.page.getByRole("region", { name: "Plan and usage" });
    await expect(readerPlan).toContainText("3 of 10 workforce listings");
    await expect(readerPlan.getByRole("link", { name: "Manage plan" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(reader.page);
    await reader.close();
  });

  test("FR-R3 AC2, FR-R4 AC2: the dashboard follows the organisation type for each kind of user", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const r = await listedPartner("recruitment_company");
    const s = await listedPartner("staffing_company");
    const employer = await newCompany();
    await joinPartner(r, "member", employer.owner);
    const rMember = await joinPartner(r, "member", await createCommittedPartner("recruitment_company"));

    const one = await signedIn(browser, rMember);
    await one.page.goto(dashboardUrl("recruitment"));
    await expect(one.page.getByRole("heading", { level: 1 })).toHaveText(RECRUITMENT_QUESTION);
    await one.page.goto("/en/dashboard/employer");
    await expect(one.page).toHaveURL(dashboardUrl("recruitment", r.slug));
    await one.page.goto(`/en/org/${r.slug}`);
    await expect(one.page).toHaveURL(dashboardUrl("recruitment", r.slug));
    await one.page.goto(dashboardUrl("staffing", s.slug));
    await expect(one.page).toHaveURL(dashboardUrl("recruitment", r.slug));
    // Only the responses whose body was received, and none after the check: a prefetch the browser cancels never
    // finishes, and a read of its body left pending holds the closing of the context.
    const bodies: Promise<string>[] = [];
    const collect = (request: Request) => {
      bodies.push(request.response().then((response) => response?.text() ?? "").catch(() => ""));
    };
    one.page.on("requestfinished", collect);
    await one.page.goto(dashboardUrl("staffing", s.slug));
    await one.page.waitForLoadState("networkidle");
    one.page.off("requestfinished", collect);
    const names = query<{ id: string; display_name: string }>(
      `select id, display_name from public.organizations where id in (${literal(r.id)}, ${literal(s.id)})`,
    );
    const nameOf = (id: string) => names.find((row) => row.id === id)?.display_name ?? id;
    const seen = (await Promise.all(bodies)).join("\n");
    expect(seen, "the responses were read: R's own dashboard is in them").toContain(nameOf(r.id));
    expect(seen.includes(s.id) || seen.includes(nameOf(s.id)), "no other organisation's figures or name").toBe(false);
    await one.close();

    const both = await signedIn(browser, employer.owner);
    await both.page.goto(dashboardUrl("recruitment", employer.slug));
    await expect(both.page).toHaveURL(dashboardUrl("employer", employer.slug));
    await both.page.goto(dashboardUrl("recruitment", r.slug));
    await expect(both.page.getByRole("heading", { level: 1 })).toHaveText(RECRUITMENT_QUESTION);
    await both.page.goto(dashboardUrl("employer", r.slug));
    await expect(both.page).toHaveURL(dashboardUrl("recruitment", r.slug));
    await both.close();

    const staffing = await signedIn(browser, s.user);
    await staffing.page.goto(dashboardUrl("recruitment", r.slug));
    await expect(staffing.page).toHaveURL(dashboardUrl("staffing", s.slug));
    await expect(staffing.page.getByRole("heading", { level: 1 })).toHaveText(STAFFING_QUESTION);
    await staffing.close();

    const candidate = await signedIn(browser, await createCommittedUser("worker"));
    await candidate.page.goto(dashboardUrl("recruitment"));
    await expect(candidate.page).toHaveURL("/en/dashboard/worker");
    await candidate.page.goto(dashboardUrl("staffing", s.slug));
    await expect(candidate.page).toHaveURL("/en/dashboard/worker");
    await candidate.close();

    await page.goto(dashboardUrl("recruitment"));
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent("/en/dashboard/recruitment")}`);
  });

  test("FR-A3: a signed-in recruitment or staffing company is redirected from the login page to the dashboard of its type", async ({
    browser,
  }) => {
    for (const [type, segment] of [
      ["recruitment_company", "recruitment"],
      ["staffing_company", "staffing"],
    ] as const) {
      const partner = await partnerWithCompany(type);
      const { page, close } = await signedIn(browser, partner.user);
      const response = await page.request.get("/en/login", { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toMatch(new RegExp(`/en/dashboard/${segment}\\?org=${partner.slug}$`));
      await close();
    }
  });

  test("FR-R4 AC1, AC5: the staffing admin confirms a stale listing by keyboard and a member sees it without Confirm", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const s = await listedPartner("staffing_company");
    seedListing(s.id, "7212", 75);
    const admin = await joinPartner(s, "admin", await createCommittedPartner("staffing_company"));
    const member = await joinPartner(s, "member", await createCommittedPartner("staffing_company"));

    const reader = await signedIn(browser, member);
    await reader.page.goto(dashboardUrl("staffing", s.slug));
    const readerRow = listingRow(reader.page, "Welders and flame cutters, Philippines");
    await expect(readerRow).toContainText("Not confirmed for 60 days or more");
    await expect(readerRow.getByRole("button")).toHaveCount(0);

    const secret = await enrollTotp(admin);
    await signInAdmin(page, admin, secret, s.slug, "staffing");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(STAFFING_QUESTION);
    const add = page.getByRole("main").getByRole("link", { name: "Add workforce" });
    await expect(add).toHaveAttribute("href", `/en/org/${s.slug}/workforce-profile#availability-heading`);
    await tabTo(page, add);
    await expectFocusVisible(add);
    const row = listingRow(page, "Welders and flame cutters, Philippines");
    // The listing starts in ten days, so none of its workers is available now, as the available workforce search counts.
    const startsOn = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.now() + 10 * 86_400_000));
    await expect(row).toContainText(`25 available from ${startsOn}, 5 per month`);
    await expect(row).not.toContainText("available now");
    const confirm = row.getByRole("button", { name: "Confirm the listing for Welders and flame cutters from Philippines" });
    await confirm.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Listing confirmed: Welders and flame cutters from Philippines", { exact: true })).toBeVisible();
    await expect(row).toContainText("Confirmed today.");
    await expect(row).not.toContainText("Not confirmed for");
    const [listing] = query<{ fresh: boolean; available: number; id: string }>(
      `select id, confirmed_at > now() - interval '5 minutes' as fresh, available from public.workforce_availability
       where organization_id = ${literal(s.id)}`,
    );
    expect(listing).toMatchObject({ fresh: true, available: 25 });
    expect(
      query<{ n: number }>(
        `select count(*)::int as n from audit.log where action = 'workforce_availability.confirmed' and entity_id = ${literal(listing.id)}`,
      )[0].n,
    ).toBe(1);

    await reader.page.reload();
    await expect(readerRow).toContainText("Confirmed today.");
    await expect(readerRow.getByRole("button")).toHaveCount(0);
    await reader.close();
  });

  test("FR-R3 AC6, AC7, FR-R4 AC7: a newly approved company sees only released blocks, each with guidance", async ({ browser }) => {
    test.setTimeout(120_000);
    for (const [type, question, action] of [
      ["staffing_company", STAFFING_QUESTION, "Add workforce"],
      ["recruitment_company", RECRUITMENT_QUESTION, "Update recruiting capacity"],
    ] as const) {
      const partner = await partnerWithCompany(type);
      execute(
        `update public.organizations set review_status = 'listed', listed_at = now(), submitted_at = now() - interval '1 day'
         where id = ${literal(partner.id)}`,
      );
      const owner = await signedIn(browser, partner.user);
      await owner.page.goto("/en/dashboard/employer");
      const segment = type === "staffing_company" ? "staffing" : "recruitment";
      await expect(owner.page).toHaveURL(dashboardUrl(segment, partner.slug));
      await expect(owner.page.getByRole("heading", { level: 1 })).toHaveText(question);
      // A recruitment company's listings are its recruiting capacity, a staffing company's its available workforce.
      const workforce = owner.page.getByRole("region", {
        name: type === "staffing_company" ? "Available workforce" : "Recruiting capacity",
      });
      await expect(workforce).toContainText(
        type === "staffing_company"
          ? "Add the workers you can supply, by country and occupation."
          : "Add how many candidates you can put forward and recruit each month, by country and occupation.",
      );
      await expect(workforce.getByRole("link", { name: action })).toBeVisible();
      const activity = owner.page.getByRole("region", { name: "Your activity" });
      await expect(activity.getByRole("link", { name: /^0 Profile views, 30 days/ })).toBeVisible();
      await expect(activity.getByRole("link", { name: /^0 Current licences/ })).toHaveAttribute(
        "href",
        `/en/org/${partner.slug}/workforce-profile#licences-heading`,
      );
      const next = owner.page.getByRole("region", { name: "Next actions" });
      await expect(next.getByRole("link", { name: /^Add the countries you source workers from/ })).toBeVisible();
      await expect(owner.page.getByText("once two-step verification is set up")).toBeVisible();
      for (const absent of [/job order/i, /invitation/i, /submission/i, /unread/i, /Respond to request/i]) {
        await expect(owner.page.getByRole("main")).not.toContainText(absent);
      }
      await expectAccessibleAtBothWidths(owner.page);
      await owner.close();
    }
  });

  test("FR-R3 AC10, FR-R4 AC9: profile views of the last 30 days, fewer than 5 below the threshold", async ({ browser }) => {
    test.setTimeout(90_000);
    const quiet = await listedPartner("recruitment_company");
    const busy = await listedPartner("staffing_company");
    execute(
      `insert into private.org_analytics_daily (organization_id, day, metric, country_code, value)
       values (${literal(quiet.id)}, current_date - 3, 'profile_views', 'DE', 3),
              (${literal(busy.id)}, current_date - 3, 'profile_views', 'DE', 8),
              (${literal(busy.id)}, current_date - 10, 'profile_views', 'PL', 4)`,
    );
    const quietOwner = await signedIn(browser, quiet.user);
    await quietOwner.page.goto(dashboardUrl("recruitment", quiet.slug));
    await expect(quietOwner.page.getByRole("region", { name: "Your activity" }).getByRole("link", { name: /^<5 Profile views, 30 days/ })).toBeVisible();
    await quietOwner.close();

    const busyOwner = await signedIn(browser, busy.user);
    await busyOwner.page.goto(dashboardUrl("staffing", busy.slug));
    await expect(busyOwner.page.getByRole("region", { name: "Your activity" }).getByRole("link", { name: /^12 Profile views, 30 days/ })).toBeVisible();
    await busyOwner.close();
  });

  test("FR-R3 AC11, FR-R4 AC10: a slow part shows a skeleton, a failed part an error with a toast and Try again", async ({ browser }) => {
    test.setTimeout(120_000);
    const r = await listedPartner("recruitment_company");
    seedListing(r.id, "7212", 2);
    const member = await joinPartner(r, "member", await createCommittedPartner("recruitment_company"));
    const reader = await signedIn(browser, member);

    const held = executeAsync("begin; lock table public.partner_licences in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await reader.page.goto(dashboardUrl("recruitment", r.slug), { waitUntil: "commit" });
    await expect(reader.page.getByRole("status", { name: "Loading" }).first()).toBeVisible();
    await expect(reader.page.getByRole("heading", { name: "Your company is listed", level: 2 })).toBeVisible();
    await expect(listingRow(reader.page, "Welders and flame cutters, Philippines")).toBeVisible();
    await expect(reader.page.getByRole("region", { name: "Next actions" })).toHaveCount(0);
    await expect(reader.page.getByRole("region", { name: "Next actions" })).toBeVisible({ timeout: 15_000 });
    await held;

    execute(`revoke execute on function ${FUNCTION} from authenticated`);
    try {
      await reader.page.goto(dashboardUrl("recruitment", r.slug));
      await expect(reader.page.getByRole("heading", { name: "The figures of your company could not be loaded", level: 2 })).toBeVisible();
      await expect(reader.page.getByText("Check your connection and try again.").first()).toBeVisible();
      await expect(reader.page.getByRole("heading", { name: "Your company is listed", level: 2 })).toBeVisible();
      await expect(listingRow(reader.page, "Welders and flame cutters, Philippines")).toBeVisible();
      await expect(reader.page.getByText(/permission denied|get_partner_dashboard/)).toHaveCount(0);
      await expectAccessibleAtBothWidths(reader.page);
    } finally {
      execute(`grant execute on function ${FUNCTION} to authenticated`);
    }
    await reader.page.getByRole("button", { name: "Try again" }).click();
    await expect(reader.page.getByRole("region", { name: "Next actions" })).toBeVisible();
    await expect(reader.page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await reader.close();
  });

  test("the partner dashboards are closed while release 2a is off", async ({ browser }) => {
    const r = await listedPartner("recruitment_company");
    const owner = await signedIn(browser, r.user);
    const member = await signedIn(browser, await joinPartner(r, "member", await createCommittedPartner("recruitment_company")));
    setPartnerRelease(false);
    try {
      await owner.page.goto(dashboardUrl("recruitment", r.slug));
      await expect(owner.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await owner.page.goto("/en/dashboard/employer");
      await expect(owner.page).toHaveURL("/en/onboarding");
      // The address of the organisation leads through the employer dashboard, so it ends on onboarding too.
      await member.page.goto(`/en/org/${r.slug}`);
      await expect(member.page).toHaveURL("/en/onboarding");
    } finally {
      setPartnerRelease(true);
    }
    await owner.close();
    await member.close();
  });
});
