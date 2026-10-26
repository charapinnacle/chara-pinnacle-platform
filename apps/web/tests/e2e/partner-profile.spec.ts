import type { Page, Response } from "@playwright/test";
import { WORKERS_NEVER_PAY } from "@/lib/validation/commitment";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { createCommittedUser } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import { registerOrganization, uniqueName } from "./support/organizations";
import { partnerWithCompany, setPartnerRelease, type PartnerType } from "./support/partners";
import { signInStaff } from "./support/admin";
import { waitForHydration } from "./support/hydration";
import { fillReport, GOOD_FAITH, openQueueAfter, sendReport } from "./support/reports";
import { newVisitor } from "./support/team";
import { readHead, robotsMeta, SITE } from "./support/seo";
import { expect, test, visitorAddress } from "./support/test";
import type { TestUser } from "./support/test-user";

type Listed = { user: TestUser; id: string; slug: string; displayName: string; legalName: string; identifier: string };

const LICENCE_NUMBER = "DMW-123-LB-031522-R";
const NOT_AVAILABLE = "This profile is not available";
const FORBIDDEN_WORDS = /\b(verified|approved|licensed|rating|reviews?|ranking|badge)\b/i;

// A listed recruitment company with a complete profile: two fresh listings and one stale one, two languages, a founded
// year, a description, a website, a current commitment, a licence and a review decision (FR-K4 AC1, AC3, AC5).
async function listedPartner(
  { complete = true, type = "recruitment_company" }: { complete?: boolean; type?: PartnerType } = {},
): Promise<Listed> {
  const { user, id, slug } = await partnerWithCompany(type);
  const org = literal(id);
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code)
     values (${org}, 'sources_from', 'PH'), (${org}, 'sources_from', 'NP'), (${org}, 'serves_market', 'DE');
     insert into public.organization_occupations (organization_id, occupation_id)
     values (${org}, '7212'), (${org}, '7411'), (${org}, '7126');
     insert into public.organization_industries (organization_id, industry_code) values (${org}, 'F');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '2 days',
       submitted_at = now() - interval '3 days', recruitment_type = 'international', workforce_profile_updated_at = now()
     where id = ${org};
     insert into public.consents (user_id, purpose, version, action)
     values (${literal(user.id)}, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
     insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until,
       confirmed_at, partner_terms_version)
     values (${org}, 'PH', 'Department of Migrant Workers', ${literal(LICENCE_NUMBER)}, current_date + 400, now(), 1);
     insert into public.partner_review_decisions (organization_id, decision, reason, from_status, to_status, submitted_at, decided_by)
     values (${org}, 'approve', 'Registry entry matches the company.', 'pending_review', 'listed', now() - interval '3 days', ${literal(user.id)})`,
  );
  if (complete) {
    execute(
      `insert into public.organization_languages (organization_id, language_code) values (${org}, 'en'), (${org}, 'tl');
       update public.organizations set founded_year = 2012, website = 'https://' || slug || '.example',
         description = 'We recruit skilled welders and electricians from the Philippines and Nepal.'
       where id = ${org};
       insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
         available_from, confirmed_at)
       values (${org}, '7212', 'PH', 40, 15, current_date + 14, now() - interval '3 days'),
              (${org}, '7411', 'NP', 25, 10, current_date + 30, now() - interval '20 days'),
              (${org}, '7126', 'PH', 99, 33, current_date + 7, now() - interval '61 days')`,
    );
  }
  const [row] = query<{ display_name: string; legal_name: string; legal_entity_identifier: string }>(
    `select display_name, legal_name, legal_entity_identifier from public.organizations where id = ${org}`,
  );
  return { user, id, slug, displayName: row.display_name, legalName: row.legal_name, identifier: row.legal_entity_identifier };
}

const profileUrl = (slug: string) => `/en/partners/${slug}`;

// The date as the pages write it (lib/i18n/format.ts formatDate), in UTC.
const longDate = (date: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(date);

// NFR-S8/S9-style privacy check: neither the HTML nor any response the browser received holds the partner's legal name,
// identifier or licence, or a member's email.
async function collectResponses(page: Page): Promise<() => Promise<string>> {
  const responses: Response[] = [];
  page.on("response", (response) => responses.push(response));
  return async () => {
    const bodies = await Promise.all(responses.map((response) => response.text().catch(() => "")));
    return bodies.join("\n");
  };
}

function expectNothingPrivate(text: string, partner: Listed): void {
  for (const secret of [partner.legalName, partner.identifier, LICENCE_NUMBER, "Department of Migrant Workers", partner.user.email, "Registry entry"]) {
    expect(text.includes(secret), `"${secret}" leaked`).toBe(false);
  }
}

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// other partner specs (playwright.config.ts), and the tests run one after the other.
test.describe("Public partner profile (FR-K4)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("AC1, AC5, AC6, AC7: a visitor reads the structured sections, and nothing private reaches the browser", async ({ page }) => {
    test.setTimeout(90_000);
    const partner = await listedPartner();
    const received = await collectResponses(page);
    const response = await page.goto(profileUrl(partner.slug));
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(partner.displayName);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByText("Based in Philippines").first()).toBeVisible();
    await expect(page.locator("main").getByRole("heading", { level: 2 })).toHaveText([
      "Overview",
      "Where we serve",
      "Industries and occupations",
      "Workforce capacity",
      "Languages",
      "Commitment",
    ]);
    await expect(page.getByText("Operating since 2012")).toBeVisible();
    await expect(page.getByText("We recruit skilled welders and electricians")).toBeVisible();
    await expect(page.getByText("International", { exact: true })).toBeVisible();

    const capacity = page.getByRole("region", { name: "Workforce capacity" });
    await expect(capacity.getByRole("listitem")).toHaveCount(2);
    await expect(capacity.getByText(/^Confirmed on \d{1,2} \w+ \d{4}$/)).toHaveCount(2);
    await expect(capacity).toContainText("Welders and flame cutters from Philippines");
    await expect(capacity).not.toContainText("99 available");
    await expect(page.getByRole("region", { name: "Languages" })).toContainText("English");
    const commitment = page.getByRole("region", { name: "Commitment" });
    await expect(commitment).toContainText(WORKERS_NEVER_PAY);
    await expect(commitment.getByRole("link", { name: "Read the employer-pays commitment" })).toHaveAttribute(
      "href",
      "/en/legal/employer-pays-commitment",
    );
    const where = page.getByRole("region", { name: "Where we serve" });
    await expect(where.getByRole("term")).toHaveText(["Based in", "Sources workers from", "Recruits for"]);
    await expect(where.getByRole("definition")).toHaveText(["Philippines", "Nepal, Philippines", "Germany"]);
    await expect(where.getByText(`Last updated ${longDate(new Date())}`)).toBeVisible();
    await expect(where.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);

    const website = page.getByRole("link", { name: /\.example/ });
    await expect(website).toHaveAttribute("rel", "nofollow noopener noreferrer");
    await expect(page.getByRole("link", { name: "Read the disclaimer" })).toBeVisible();

    const visible = await page.locator("main").innerText();
    expect(visible).not.toMatch(FORBIDDEN_WORDS);
    const html = await page.content();
    expectNothingPrivate(html, partner);
    expectNothingPrivate(await received(), partner);
    expect(await (await page.request.get(profileUrl(partner.slug))).text()).not.toContain(partner.legalName);

    const head = await readHead(page);
    expect(head.title).toBe(`${partner.displayName} - Recruitment company in the Philippines | Chara Pinnacle`);
    expect(head.canonical).toBe(`${SITE}/en/partners/${partner.slug}`);
    expect(head.description?.length).toBeLessThanOrEqual(160);
    expect(head.description).toContain("We recruit skilled welders");
    await expect(robotsMeta(page)).toHaveCount(0);

    await expectAccessibleAtBothWidths(page);
  });

  test("FR-K1 AC9: a staffing company's profile says where it supplies workers", async ({ page }) => {
    const partner = await listedPartner({ complete: false, type: "staffing_company" });
    await page.goto(profileUrl(partner.slug));
    const where = page.getByRole("region", { name: "Where we serve" });
    await expect(where.getByRole("term")).toHaveText(["Based in", "Sources workers from", "Supplies workers for"]);
    await expect(where.getByText(`Last updated ${longDate(new Date())}`)).toBeVisible();
    await expect(page.getByText("Staffing company · Based in Philippines")).toBeVisible();
  });

  test("AC6: a signed-in employer's page holds no private data either", async ({ page }) => {
    const partner = await listedPartner();
    const employer = await createCommittedUser("company");
    await registerOrganization(employer, `${uniqueName("Profile Viewer")} GmbH`);
    await logIn(page, employer);
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    const received = await collectResponses(page);
    await page.goto(profileUrl(partner.slug));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(partner.displayName);
    expectNothingPrivate(await page.content(), partner);
    expectNothingPrivate(await received(), partner);
  });

  test("AC2: not public, unknown and release off answer the same 404; a member previews the profile", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const unknown = await page.request.get(profileUrl("no-such-partner-anywhere"));
    expect(unknown.status()).toBe(404);
    const unknownText = await page.goto(profileUrl("no-such-partner-anywhere")).then(() => page.locator("main").innerText());
    expect(unknownText).toContain(NOT_AVAILABLE);

    const pending = await partnerWithCompany("recruitment_company");
    execute(`update public.organizations set review_status = 'pending_review', submitted_at = now() where id = ${literal(pending.id)}`);
    const states: [string, string][] = [["onboarding", "review_status = 'onboarding'"], ["pending", "review_status = 'pending_review', submitted_at = now()"],
      ["info requested", "review_status = 'info_requested', submitted_at = now(), info_step = 'company'"],
      ["declined", "review_status = 'declined', submitted_at = now()"]];
    const slugs: [string, string][] = [];
    for (const [label, change] of states) {
      const { id, slug } = await partnerWithCompany("staffing_company");
      execute(`update public.organizations set ${change} where id = ${literal(id)}`);
      slugs.push([label, slug]);
    }
    const suspended = await listedPartner({ complete: false });
    execute(`update public.organizations set status = 'suspended' where id = ${literal(suspended.id)}`);
    slugs.push(["suspended", suspended.slug]);

    const employer = await createCommittedUser("company");
    await registerOrganization(employer, `${uniqueName("Status Viewer")} GmbH`);
    const signedIn = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": visitorAddress() } });
    const employerPage = await signedIn.newPage();
    await logIn(employerPage, employer);
    await employerPage.waitForURL((url) => !url.pathname.endsWith("/login"));

    for (const [label, slug] of slugs) {
      const visitor = await page.goto(profileUrl(slug));
      expect(visitor?.status(), `${label} as a visitor`).toBe(404);
      expect(await page.locator("main").innerText(), label).toBe(unknownText);
      const asEmployer = await employerPage.goto(profileUrl(slug));
      expect(asEmployer?.status(), `${label} as an employer`).toBe(404);
      await expect(employerPage.getByRole("heading", { level: 1 })).toHaveText(NOT_AVAILABLE);
    }
    await signedIn.close();

    const listed = await listedPartner({ complete: false });
    setPartnerRelease(false);
    expect((await page.request.get(profileUrl(listed.slug))).status(), "release off").toBe(404);
    setPartnerRelease(true);
    expect((await page.request.get(profileUrl(listed.slug))).status(), "release on").toBe(200);

    await logIn(page, pending.user);
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    await page.goto(`/en/org/${pending.slug}/workforce-profile/preview`);
    await expect(page.getByText("Preview - not public")).toBeVisible();
    await expect(robotsMeta(page)).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Manila Skills/);
    await expect(page.getByRole("link", { name: "Report company" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
  });

  test("AC4: the actions depend on the viewer and are reachable by Tab", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const partner = await listedPartner({ complete: false });

    await page.goto(profileUrl(partner.slug));
    await expect(page.getByRole("link", { name: "Sign up to contact" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Report company" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit profile" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: `Follow ${partner.displayName}` }), "FR-L4 AC9: Follow leads a visitor to log in").toHaveAttribute(
      "href",
      `/en/login?next=${encodeURIComponent(profileUrl(partner.slug))}`,
    );
    const reached: string[] = [];
    for (let step = 0; step < 40 && reached.length < 2; step++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      if (["Sign up to contact", "Report company"].includes(name) && !reached.includes(name)) reached.push(name);
    }
    expect(reached.sort()).toEqual(["Report company", "Sign up to contact"]);

    // FR-L4 roles: employers save and follow, candidates and other partners follow, the partner's own members do neither.
    const viewers: [string, TestUser, boolean, { save: number; follow: number }][] = [];
    const employer = await createCommittedUser("company");
    await registerOrganization(employer, `${uniqueName("Action Viewer")} GmbH`);
    viewers.push(["employer", employer, false, { save: 1, follow: 1 }]);
    viewers.push(["worker", await createCommittedUser("worker"), false, { save: 0, follow: 1 }]);
    viewers.push(["other partner", (await partnerWithCompany("staffing_company")).user, false, { save: 0, follow: 1 }]);
    viewers.push(["own member", partner.user, true, { save: 0, follow: 0 }]);

    for (const [label, user, member, buttons] of viewers) {
      const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": visitorAddress() } });
      const viewerPage = await context.newPage();
      await logIn(viewerPage, user);
      await viewerPage.waitForURL((url) => !url.pathname.endsWith("/login"));
      await viewerPage.goto(profileUrl(partner.slug));
      await expect(viewerPage.getByRole("heading", { level: 1 })).toHaveText(partner.displayName);
      await expect(viewerPage.getByRole("link", { name: "Sign up to contact" }), label).toHaveCount(0);
      await expect(viewerPage.getByRole("link", { name: "Report company" }), label).toHaveCount(member ? 0 : 1);
      await expect(viewerPage.getByRole("link", { name: "Report a fee demand" }), label).toHaveCount(member ? 0 : 1);
      await expect(viewerPage.getByRole("link", { name: "Edit profile" }), label).toHaveCount(member ? 1 : 0);
      await expect(viewerPage.getByRole("button", { name: `Save partner: ${partner.displayName}` }), label).toHaveCount(buttons.save);
      await expect(viewerPage.getByRole("button", { name: `Follow: ${partner.displayName}` }), label).toHaveCount(buttons.follow);
      if (member) {
        await expect(viewerPage.getByRole("link", { name: "Edit profile" })).toHaveAttribute("href", `/en/org/${partner.slug}/workforce-profile`);
      }
      await context.close();
    }
  });

  test("FR-R6 AC1: a company that reads the profile is counted once a day; the partner, its preview and visitors are not", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const partner = await listedPartner({ complete: false });
    const viewsOf = () =>
      query<{ viewer: string; days_ago: number }>(
        `select viewer_organization_id as viewer, current_date - viewed_on as days_ago from private.profile_view_events
         where viewed_organization_id = ${literal(partner.id)} order by viewer_organization_id`,
      );

    await page.goto(profileUrl(partner.slug));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(partner.displayName);

    const employer = await createCommittedUser("company");
    await registerOrganization(employer, `${uniqueName("Counted Viewer")} GmbH`);
    const [{ id: employerOrg }] = query<{ id: string }>(
      `select organization_id as id from public.organization_members where user_id = ${literal(employer.id)}`,
    );
    const viewers: [TestUser, number][] = [[employer, 2], [partner.user, 1], [await createCommittedUser("worker"), 1]];
    for (const [user, reads] of viewers) {
      const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": visitorAddress() } });
      const viewerPage = await context.newPage();
      await logIn(viewerPage, user);
      await viewerPage.waitForURL((url) => !url.pathname.endsWith("/login"));
      for (let read = 0; read < reads; read++) {
        await viewerPage.goto(profileUrl(partner.slug));
        await expect(viewerPage.getByRole("heading", { level: 1 })).toHaveText(partner.displayName);
      }
      if (user === partner.user) {
        await viewerPage.goto(`/en/org/${partner.slug}/workforce-profile/preview`);
        await expect(viewerPage.getByRole("heading", { level: 1 })).toHaveText(partner.displayName);
      }
      await context.close();
    }

    expect(viewsOf()).toEqual([{ viewer: employerOrg, days_ago: 0 }]);
    const notFound = await page.goto(profileUrl(`${partner.slug}-gone`));
    expect(notFound?.status()).toBe(404);
    expect(viewsOf()).toHaveLength(1);
  });

  test("AC10, FR-S1 AC1: a visitor reports the company from its profile as a partner_profile report", async ({ page }) => {
    const partner = await listedPartner({ complete: false });
    await page.goto(profileUrl(partner.slug));
    await page.getByRole("link", { name: "Report company" }).click();
    await expect(page).toHaveURL(`/en/report?type=partner_profile&partner=${partner.slug}`);
    await expect(page.getByRole("heading", { name: "Report a company", level: 1 })).toBeVisible();
    await expect(page.getByText(`/en/partners/${partner.slug}`)).toBeVisible();
    await expect(page.getByLabel("What is wrong")).toHaveValue("");
    await fillReport(page, { category: "misleading_or_fraud", details: "This company claims placements it never made.", email: "visitor@example.test" });
    const reference = await sendReport(page);
    expect(reference).toMatch(/^R-\d{6,}$/);
    await expect(page.getByText(/other reports/i)).toHaveCount(0);
    await expect(page.getByText("Trust & Safety handles reports of fee demands first")).toHaveCount(0);
    const rows = query<{ target_type: string; organization_id: string; content_path: string | null; job_id: string | null; category: string; reporter_email: string }>(
      `select target_type::text, organization_id, content_path, job_id, category::text, reporter_email from public.reports
       where organization_id = ${literal(partner.id)}`,
    );
    expect(rows).toEqual([
      { target_type: "partner_profile", organization_id: partner.id, content_path: null, job_id: null, category: "misleading_or_fraud", reporter_email: "visitor@example.test" },
    ]);
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-J3 AC8, FR-S1 AC3, AC10: a worker reports a fee demand from the profile, and Trust & Safety see it first with its due time", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const partner = await listedPartner({ complete: false });
    const worker = await createCommittedUser("worker");
    await logIn(page, worker);
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    await page.goto(profileUrl(partner.slug));
    const trigger = page.getByRole("link", { name: "Report a fee demand" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/en/report?type=partner_profile&partner=${partner.slug}&category=fee_demanded_from_worker`);
    const category = page.getByLabel("What is wrong");
    await waitForHydration(page.getByLabel("What happened"));
    await expect(category).toHaveValue("fee_demanded_from_worker");
    await expect(category.locator("option:checked")).toHaveText("The company asked me to pay a fee");
    await expect(page.getByLabel("Your email (optional)")).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("What happened").fill("The recruiter asked me for 900 euros before the visa.");
    await page.getByLabel(GOOD_FAITH).check();
    const reference = await sendReport(page);
    await expect(page.getByRole("status")).toContainText("Trust & Safety handles reports of fee demands first.");
    const [stored] = query<{ id: number; target_type: string; priority: number; on_time: boolean; reporter_user_id: string }>(
      `select id, target_type::text, priority, due_at = private.add_working_days(created_at, 1) as on_time, reporter_user_id
       from public.reports where organization_id = ${literal(partner.id)}`,
    );
    expect(stored).toEqual({ id: Number(reference.slice(2)), target_type: "partner_profile", priority: 1, on_time: true, reporter_user_id: worker.id });

    const staff = await newVisitor(browser);
    await signInStaff(staff.page, "trust_safety", `/en/admin/reports?status=open&after=${openQueueAfter(stored.id)}`);
    const row = staff.page.getByRole("table", { name: "Reports" }).getByRole("row").nth(1);
    await expect(row).toContainText(reference);
    await expect(row).toContainText(`Partner profile: ${partner.displayName}`);
    await expect(row).toContainText("Fee demand");
    await expect(row.locator("td").last().locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
    await expect(row).not.toContainText("Overdue");
    await row.getByRole("link", { name: reference }).click();
    await expect(staff.page.getByRole("heading", { name: `Report ${reference}`, level: 1 })).toBeVisible();
    const report = staff.page.locator("#report");
    await expect(report).toContainText("Partner profile");
    await expect(report).toContainText("Fee demand");
    await expect(report).toContainText("Due");
    await expect(report).toContainText("A signed-in account");
    await expect(report).not.toContainText(worker.email);
    const target = staff.page.locator("#target");
    await expect(target).toContainText(partner.displayName);
    await expect(target.getByRole("link", { name: "Open the public profile" })).toHaveAttribute("href", profileUrl(partner.slug));
    await expect(target.getByRole("link", { name: "Open the organisation to suspend or reinstate it" })).toHaveAttribute("href", `/en/admin/organizations/${partner.id}`);
    await expectAccessibleAtBothWidths(staff.page);
    await staff.context.close();
  });

  test("FR-S1 AC2: a profile that is not public cannot be reported, and the report form of a partner needs release 2a", async ({ page }) => {
    const unlisted = await partnerWithCompany("recruitment_company");
    await page.goto(`/en/report?type=partner_profile&partner=${unlisted.slug}`);
    await fillReport(page, { category: "other", details: "This company is not what it claims to be." });
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("This company profile cannot be reported: it is not public.").first()).toBeVisible();
    expect(query(`select 1 from public.reports where organization_id = ${literal(unlisted.id)}`)).toEqual([]);
    expect((await page.request.get("/en/report?type=partner_profile")).status(), "no slug").toBe(404);
    setPartnerRelease(false);
    try {
      expect((await page.request.get(`/en/report?type=partner_profile&partner=${unlisted.slug}`)).status(), "release off").toBe(404);
    } finally {
      setPartnerRelease(true);
    }
  });

  test("AC11: a profile without listings and languages says so, omits Languages and fits 360 px", async ({ page }) => {
    const partner = await listedPartner({ complete: false });
    await page.goto(profileUrl(partner.slug));
    await expect(page.getByRole("region", { name: "Workforce capacity" })).toContainText("No current availability listed");
    await expect(page.getByRole("heading", { name: "Languages" })).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessibleAtBothWidths(page);
  });

  test("AC9: over the visitor limit the page says so instead of the profile", async ({ page }) => {
    const partner = await listedPartner({ complete: false });
    execute(`update private.settings set value = '2' where key = 'rate_limit_partner_profile_max'`);
    try {
      for (let read = 1; read <= 2; read++) {
        await page.goto(profileUrl(partner.slug));
        await expect(page.getByRole("heading", { level: 1 }), `read ${read}`).toHaveText(partner.displayName);
      }
      await page.goto(profileUrl(partner.slug));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Too many requests, please try again in a minute");
      await expect(page.getByText(partner.displayName)).toHaveCount(0);
      await expect(robotsMeta(page)).toHaveAttribute("content", /noindex/);
    } finally {
      execute(`update private.settings set value = '120' where key = 'rate_limit_partner_profile_max'`);
    }
  });

  test("AC7: the sitemap lists listed profiles only, and none while the release is off", async ({ page }) => {
    const listed = await listedPartner({ complete: false });
    const unlisted = await partnerWithCompany("recruitment_company");
    const suspended = await listedPartner({ complete: false });
    execute(`update public.organizations set status = 'suspended' where id = ${literal(suspended.id)}`);
    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`<loc>${SITE}/en/partners/${listed.slug}</loc>`);
    expect(sitemap).not.toContain(`/en/partners/${unlisted.slug}<`);
    expect(sitemap).not.toContain(`/en/partners/${suspended.slug}<`);
    const today = new Date().toISOString().slice(0, 10);
    expect(sitemap).toMatch(new RegExp(`/en/partners/${listed.slug}</loc>\\s*<lastmod>${today}</lastmod>`));
    setPartnerRelease(false);
    try {
      expect(await (await page.request.get("/sitemap.xml")).text()).not.toContain("/en/partners/");
    } finally {
      setPartnerRelease(true);
    }
  });
});
