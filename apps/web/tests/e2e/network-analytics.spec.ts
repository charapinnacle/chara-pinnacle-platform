import { readFileSync } from "node:fs";
import type { Browser, Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { createCommittedPartner, partnerWithCompany, setPartnerRelease, type PartnerType } from "./support/partners";
import { signInBrowser } from "./support/session";
import { addMember, enforceLimits, newTeam, restoreLimits, subscribe } from "./support/team";
import { expect, test } from "./support/test";
import type { TestUser } from "./support/test-user";

type Partner = { user: TestUser; id: string; slug: string };

const ACCESS_FUNCTION = "public.get_org_analytics_access(uuid)";
const analyticsUrl = (slug: string, period?: string) => `/en/org/${slug}/analytics${period ? `?period=${period}` : ""}`;

function setJobOrderRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

function setMessagingRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_messaging'`);
}

// A listed partner on plan p_plan, with the counts of the last days: profile views from Germany (12) and Austria (3), and
// six invitations from Germany for welders.
async function partnerOnPlan(type: PartnerType, plan: string, { figures = true } = {}): Promise<Partner> {
  const partner = await partnerWithCompany(type);
  execute(
    `update public.organizations set review_status = 'listed', listed_at = now() - interval '20 days',
       submitted_at = now() - interval '21 days' where id = ${literal(partner.id)};
     insert into billing.subscriptions (organization_id, plan_code, status, provider)
     values (${literal(partner.id)}, ${literal(plan)}, 'active', 'null');`,
  );
  if (figures) {
    execute(
      `insert into private.org_analytics_daily (organization_id, day, metric, country_code, occupation_id, value)
       values (${literal(partner.id)}, current_date - 3, 'profile_views', 'DE', null, 12),
              (${literal(partner.id)}, current_date - 3, 'profile_views', 'AT', null, 3),
              (${literal(partner.id)}, current_date - 2, 'invitations', 'DE', null, 6),
              (${literal(partner.id)}, current_date - 2, 'invitations', null, '7212', 6),
              (${literal(partner.id)}, current_date - 40, 'profile_views', 'DE', null, 20)`,
    );
  }
  return partner;
}

async function joinAsMember(partner: Partner, type: PartnerType): Promise<TestUser> {
  const member = await createCommittedPartner(type);
  execute(
    `insert into public.organization_members (organization_id, user_id, role, accepted_at, invited_by)
     values (${literal(partner.id)}, ${literal(member.id)}, 'member', now(), ${literal(partner.user.id)})`,
  );
  return member;
}

async function signedIn(browser: Browser, user: TestUser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  await signInBrowser(context, user);
  return { page: await context.newPage(), close: () => context.close() };
}

const totalRow = (page: Page, metric: string) =>
  page.getByRole("table", { name: "Totals" }).getByRole("row").filter({ has: page.getByRole("rowheader", { name: metric, exact: true }) });

// Sets releases 2a and 2b and the plan limits for the whole database, and withdraws a function from the API role for a
// moment, so this file has a project of its own (playwright.config.ts).
test.describe("Network analytics (FR-R6, release 2a and 2b)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => {
    setPartnerRelease(true);
    setJobOrderRelease(true);
    enforceLimits();
  });
  test.afterAll(() => {
    execute(`grant execute on function ${ACCESS_FUNCTION} to authenticated`);
    restoreLimits();
    setJobOrderRelease(false);
    setPartnerRelease(false);
  });

  test("FR-R6 AC8: the Partner plan sees totals and the notice about breakdowns, and chooses the period by keyboard", async ({ browser }) => {
    test.setTimeout(120_000);
    const r = await partnerOnPlan("recruitment_company", "recruitment_partner");
    const owner = await signedIn(browser, r.user);
    await owner.page.goto(`/en/dashboard/recruitment?org=${r.slug}`);
    await owner.page.getByRole("link", { name: "Analytics" }).first().click();
    await expect(owner.page).toHaveURL(analyticsUrl(r.slug));
    await expect(owner.page.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible();

    await expect(totalRow(owner.page, "Profile views")).toContainText("15");
    await expect(totalRow(owner.page, "Invitations received")).toContainText("6");
    await expect(totalRow(owner.page, "Responses sent")).toContainText("fewer than 5");
    await expect(owner.page.getByText("Breakdowns by country and occupation are included in Professional.")).toBeVisible();
    await expect(owner.page.getByRole("link", { name: "Compare plans" })).toHaveAttribute("href", `/en/org/${r.slug}/billing`);
    await expect(owner.page.getByRole("heading", { name: "By country" })).toHaveCount(0);
    await expect(owner.page.getByRole("button", { name: "Download CSV" })).toHaveCount(0);

    const periods = owner.page.getByRole("group", { name: "Period" });
    await expect(periods.getByRole("link", { name: "Last 30 days" })).toHaveAttribute("aria-current", "page");
    await periods.getByRole("link", { name: "Last 12 months" }).focus();
    await owner.page.keyboard.press("Enter");
    await expect(owner.page).toHaveURL(analyticsUrl(r.slug, "12m"));
    await expect(periods.getByRole("link", { name: "Last 12 months" })).toHaveAttribute("aria-current", "page");
    await expect(totalRow(owner.page, "Profile views")).toContainText("35");
    await periods.getByRole("link", { name: "Last 7 days" }).click();
    await expect(totalRow(owner.page, "Profile views")).toContainText("15");
    await expectAccessibleAtBothWidths(owner.page);
    await owner.close();

    const member = await signedIn(browser, await joinAsMember(r, "recruitment_company"));
    await member.page.goto(analyticsUrl(r.slug));
    await expect(member.page.getByText("Breakdowns by country and occupation are included in Professional.")).toBeVisible();
    await expect(member.page.getByRole("link", { name: "Compare plans" })).toHaveCount(0);
    await member.close();
  });

  test("FR-R6 AC8: Professional sees the tables by country and occupation, fewer than 5 in place of small counts", async ({ browser }) => {
    test.setTimeout(120_000);
    const s = await partnerOnPlan("staffing_company", "staffing_professional");
    // With Austria the only small count, the smallest shown country would be hidden as well (complementary suppression);
    // France, smaller than Germany, takes that place so Germany is shown.
    execute(
      `insert into private.org_analytics_daily (organization_id, day, metric, country_code, occupation_id, value)
       values (${literal(s.id)}, current_date - 3, 'profile_views', 'FR', null, 9)`,
    );
    const member = await signedIn(browser, await joinAsMember(s, "staffing_company"));
    await member.page.goto(analyticsUrl(s.slug));
    const byCountry = member.page.getByRole("region", { name: "By country" });
    await expect(byCountry.getByRole("columnheader", { name: "Profile views" })).toBeVisible();
    await expect(byCountry.getByRole("row", { name: /Germany/ })).toContainText("12");
    await expect(byCountry.getByRole("row", { name: /Austria/ })).toContainText("fewer than 5");
    await expect(member.page.getByRole("region", { name: "By occupation" }).getByRole("row", { name: /Welders and flame cutters/ })).toContainText("6");
    await expect(member.page.getByRole("button", { name: "Download CSV" })).toHaveCount(0);
    await expect(member.page.getByText(/viewed by|viewer/i)).toHaveCount(0);
    await expectAccessibleAtBothWidths(member.page);
    await member.close();
  });

  test("FR-R6 AC8, AC9, AC10: Enterprise downloads the CSV of aggregates, and each download is audited", async ({ browser }) => {
    test.setTimeout(120_000);
    const e = await partnerOnPlan("recruitment_company", "recruitment_enterprise");
    const member = await signedIn(browser, await joinAsMember(e, "recruitment_company"));
    await member.page.goto(analyticsUrl(e.slug, "90d"));
    const [download] = await Promise.all([
      member.page.waitForEvent("download"),
      member.page.getByRole("button", { name: "Download CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`analytics-${e.slug}-90d.csv`);
    const lines = readFileSync((await download.path()) as string, "utf8").split("\r\n");
    expect(lines[0]).toBe("period_start,period_end,metric,country,occupation,count");
    expect(lines).toContainEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2},\d{4}-\d{2}-\d{2},profile_views,,,35$/));
    expect(lines).toContainEqual(expect.stringMatching(/,profile_views,Austria,,fewer than 5$/));
    expect(lines).toContainEqual(expect.stringMatching(/,invitations,,Welders and flame cutters,6$/));
    expect(lines.join("\n")).not.toContain(e.user.email);
    const audits = query<{ count: number }>(
      `select count(*)::integer as count from audit.log where action = 'analytics.exported' and entity_id = ${literal(e.id)}
         and metadata = '{"period": "90d"}'::jsonb`,
    );
    expect(audits[0].count).toBe(1);
    await expectAccessibleAtBothWidths(member.page);
    await member.close();
  });

  test("FR-R6 AC12: a new company sees no activity yet, and a failed read shows a toast and Try again", async ({ browser }) => {
    test.setTimeout(120_000);
    const fresh = await partnerOnPlan("recruitment_company", "recruitment_professional", { figures: false });
    const owner = await signedIn(browser, fresh.user);
    await owner.page.goto(analyticsUrl(fresh.slug));
    await expect(owner.page.getByRole("heading", { name: "No activity yet" })).toBeVisible();
    await expect(owner.page.getByText("Figures appear the day after employers or partners interact with your profile.")).toBeVisible();
    await expect(owner.page.getByRole("link", { name: "Complete your profile" })).toHaveAttribute("href", `/en/org/${fresh.slug}/workforce-profile`);
    await expectAccessibleAtBothWidths(owner.page);

    execute(`revoke execute on function ${ACCESS_FUNCTION} from authenticated`);
    try {
      await owner.page.reload();
      await expect(owner.page.getByRole("heading", { name: "Your analytics could not be loaded" })).toBeVisible();
      await expect(owner.page.getByText("Check your connection and try again.").first()).toBeVisible();
      await expect(owner.page.getByText(/permission denied|get_org_analytics/)).toHaveCount(0);
      await expectAccessibleAtBothWidths(owner.page);
    } finally {
      execute(`grant execute on function ${ACCESS_FUNCTION} to authenticated`);
    }
    await owner.page.getByRole("button", { name: "Try again" }).click();
    await expect(owner.page.getByRole("heading", { name: "No activity yet" })).toBeVisible();
    await owner.close();
  });

  test("FR-R6 AC8 (V76): inquiries received by a partner and sent by an employer show while release 2c is on", async ({ browser }) => {
    test.setTimeout(120_000);
    const s = await partnerOnPlan("staffing_company", "staffing_professional");
    const employer = await newTeam();
    subscribe(employer, "employer_professional");
    const { user: employerMember } = await addMember(employer, "member");
    execute(
      `insert into private.org_analytics_daily (organization_id, day, metric, country_code, occupation_id, value)
       values (${literal(s.id)}, current_date - 2, 'inquiries', 'DE', null, 17),
              (${literal(s.id)}, current_date - 3, 'inquiries', 'PL', null, 2),
              (${literal(s.id)}, current_date - 3, 'inquiries', 'AT', null, 3),
              (${literal(employer.id)}, current_date - 2, 'inquiries', 'NP', null, 8)`,
    );

    const partner = await signedIn(browser, s.user);
    await partner.page.goto(analyticsUrl(s.slug));
    await expect(totalRow(partner.page, "Profile views")).toContainText("15");
    await expect(totalRow(partner.page, "Inquiries received")).toHaveCount(0);

    setMessagingRelease(true);
    try {
      await partner.page.reload();
      await expect(totalRow(partner.page, "Inquiries received")).toContainText("22");
      const byCountry = partner.page.getByRole("region", { name: "By country" });
      await expect(byCountry.getByRole("columnheader", { name: "Inquiries received" })).toBeVisible();
      await expect(byCountry.getByRole("row", { name: /Germany/ })).toContainText("17");
      await expect(byCountry.getByRole("row", { name: /Poland/ })).toContainText("fewer than 5");
      await expect(partner.page.getByRole("region", { name: "By occupation" }).getByRole("columnheader", { name: "Inquiries received" })).toHaveCount(0);
      await expectAccessibleAtBothWidths(partner.page);

      const sender = await signedIn(browser, employerMember);
      await sender.page.goto(analyticsUrl(employer.slug));
      await expect(totalRow(sender.page, "Inquiries sent")).toContainText("8");
      await expect(sender.page.getByRole("region", { name: "By country" }).getByRole("row", { name: /Nepal/ })).toContainText("8");
      await expect(totalRow(sender.page, "Profile views")).toHaveCount(0);
      await expectAccessibleAtBothWidths(sender.page);
      await sender.close();
    } finally {
      setMessagingRelease(false);
    }
    await partner.close();
  });

  test("the analytics page is closed to outsiders and while release 2a is off", async ({ browser }) => {
    const r = await partnerOnPlan("recruitment_company", "recruitment_partner");
    const other = await partnerOnPlan("staffing_company", "staffing_professional", { figures: false });
    const outsider = await signedIn(browser, other.user);
    await outsider.page.goto(analyticsUrl(r.slug));
    await expect(outsider.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await outsider.close();

    const owner = await signedIn(browser, r.user);
    setPartnerRelease(false);
    try {
      await owner.page.goto(analyticsUrl(r.slug));
      await expect(owner.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    } finally {
      setPartnerRelease(true);
    }
    await owner.close();
  });
});
