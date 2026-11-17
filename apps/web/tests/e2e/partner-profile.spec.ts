import type { Page, Request } from "@playwright/test";
import { WORKERS_NEVER_PAY } from "@/lib/validation/commitment";
import { displayName, expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { createCommittedUser, enrollTotp } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { registerOrganization, uniqueName } from "./support/organizations";
import { partnerWithCompany, setPartnerRelease, type PartnerType } from "./support/partners";
import { signInStaff } from "./support/admin";
import { waitForHydration } from "./support/hydration";
import { fillReport, GOOD_FAITH, openQueueAfter, sendReport } from "./support/reports";
import { newVisitor, signInAtAal1, signInAtAal2 } from "./support/team";
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
// identifier or licence, or a member's email. Only the responses whose body was received are read, and none after the
// read: a prefetch the browser cancels never finishes, so a read of its body would wait for good.
async function collectResponses(page: Page): Promise<() => Promise<string>> {
  const bodies: Promise<string>[] = [];
  const collect = (request: Request) => {
    bodies.push(request.response().then((response) => response?.text() ?? "").catch(() => ""));
  };
  page.on("requestfinished", collect);
  return async () => {
    page.off("requestfinished", collect);
    return (await Promise.all(bodies)).join("\n");
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
    await expect(capacity.getByRole("listitem"), "FR-K3 AC4: a visitor reads no listing").toHaveCount(0);
    await expect(capacity).not.toContainText("available");
    await expect(capacity.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/en/login?next=${encodeURIComponent(`/en/partners/${partner.slug}`)}`,
    );
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

  test("AC6, FR-K3 AC4: a signed-in employer reads the capacity, and the page holds no private data either", async ({ page }) => {
    const partner = await listedPartner();
    const employer = await createCommittedUser("company");
    await registerOrganization(employer, `${uniqueName("Profile Viewer")} GmbH`);
    await logIn(page, employer);
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    const received = await collectResponses(page);
    await page.goto(profileUrl(partner.slug));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(partner.displayName);
    const capacity = page.getByRole("region", { name: "Workforce capacity" });
    await expect(capacity.getByRole("listitem"), "FR-K3 AC4: a signed-in reader reads the fresh listings").toHaveCount(2);
    await expect(capacity.getByText(/^Confirmed on \d{1,2} \w+ \d{4}$/)).toHaveCount(2);
    await expect(capacity).toContainText("Welders and flame cutters from Philippines");
    await expect(capacity).not.toContainText("99 available");
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
    await expect(page.getByRole("link", { name: "Sign in to contact" }), "FR-P2 AC9: a visitor signs in with a safe next value").toHaveAttribute(
      "href",
      `/en/login?next=${encodeURIComponent(profileUrl(partner.slug))}`,
    );
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
      if (["Sign in to contact", "Report company"].includes(name) && !reached.includes(name)) reached.push(name);
    }
    expect(reached.sort()).toEqual(["Report company", "Sign in to contact"]);

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
      await expect(viewerPage.getByRole("link", { name: "Sign in to contact" }), label).toHaveCount(0);
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
    await expect(page.getByRole("main").getByText(partner.displayName, { exact: true })).toBeVisible();
    await expect(page.getByText(`/en/partners/${partner.slug}`), "the company is named, not its path").toHaveCount(0);
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
    await expect(page.getByRole("region", { name: "Workforce capacity" }), "a visitor is asked to sign in").toContainText(
      "Sign in to see the workers available",
    );
    const reader = await createCommittedUser("company");
    await logIn(page, reader);
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
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
  test("FR-S1 AC4, AC8, AC10, AC12, FR-J3 AC9: Trust & Safety hide a reported profile by keyboard, the partner reads the badge and the reasons, and staff show it again", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const partner = await listedPartner();
    const worker = await createCommittedUser("worker");
    const id = Number(execute(
      `insert into public.reports (target_type, organization_id, category, details, good_faith_confirmed, reporter_user_id)
       values ('partner_profile', ${literal(partner.id)}, 'fee_demanded_from_worker', 'The recruiter asked me for 900 euros before the visa.', true,
               ${literal(worker.id)}) returning id`,
    ).trim().split("\n")[0]);
    const reasons = "The company asked a worker to pay 900 euros before the visa, against its employer-pays commitment.";

    const staff = await newVisitor(browser);
    await signInStaff(staff.page, "trust_safety", `/en/admin/reports/${id}`);
    await expect(staff.page.locator("#report")).toContainText("Decision due");
    const target = staff.page.locator("#target");
    await expect(target).toContainText("Visible");
    const listings = target.getByRole("table", { name: "Availability listings, stale ones included" });
    await expect(listings.getByRole("row")).toHaveCount(4);
    await expect(listings.getByText("Stale", { exact: true })).toHaveCount(1);
    await expectAccessibleAtBothWidths(staff.page);
    await staff.page.setViewportSize({ width: 1280, height: 900 });

    const hide = staff.page.getByRole("button", { name: "Hide", exact: true });
    await waitForHydration(hide);
    await hide.focus();
    await staff.page.keyboard.press("Enter");
    const dialog = staff.page.getByRole("dialog", { name: "Hide the partner profile" });
    await expect(dialog).toContainText(`Partner profile:${partner.displayName}`);
    await expect(dialog).toContainText(`Organisation:${partner.displayName}`);
    await expect(dialog.getByLabel("Statement of reasons")).toBeFocused();
    await staff.page.keyboard.type("Too short");
    await expect(dialog).toContainText("9 of 2000 characters used");
    await dialog.getByRole("button", { name: "Hide" }).focus();
    await staff.page.keyboard.press("Enter");
    await expect(dialog.getByText("Give a reason of at least 10 characters").first()).toBeVisible();
    await dialog.getByLabel("Statement of reasons").fill(reasons);
    await expectNoAxeViolations(staff.page);
    await dialog.getByRole("button", { name: "Hide" }).focus();
    await staff.page.keyboard.press("Enter");
    await expect(staff.page.getByText("Hidden. The report is actioned", { exact: true })).toBeVisible();
    const decision = staff.page.locator("#decision");
    await expect(decision).toContainText("Actioned");
    await expect(decision).toContainText("Partner profile hidden");
    await expect(decision).toContainText(reasons);

    expect(query<{ action: string; report_id: number }>(
      `select action, report_id from public.moderation_actions where target_type = 'partner_profile' and target_id = ${literal(partner.id)}`,
    )).toEqual([{ action: "content_hidden", report_id: id }]);
    expect(query<{ decision: string; reasons: string; mandatory: boolean }>(
      `select payload ->> 'decision' as decision, payload ->> 'reasons' as reasons, mandatory from public.notifications
       where kind = 'moderation_decision' and user_id = ${literal(partner.user.id)}`,
    )).toEqual([{ decision: "hide", reasons, mandatory: true }]);
    expect(query<{ payload: Record<string, string> }>(
      `select payload from public.notifications where kind = 'moderation_decision' and user_id = ${literal(worker.id)}`,
    )).toEqual([{ payload: { reference: `R-${String(id).padStart(6, "0")}`, outcome: "actioned" } }]);
    expect((await page.request.get(profileUrl(partner.slug))).status(), "hidden profile").toBe(404);

    // A second report on the same partner asks for what is already in effect: it is closed actioned without a second hide.
    const second = Number(execute(
      `insert into public.reports (target_type, organization_id, category, details, good_faith_confirmed)
       values ('partner_profile', ${literal(partner.id)}, 'misleading_or_fraud', 'The same profile claims placements it never made.', true) returning id`,
    ).trim().split("\n")[0]);
    await staff.page.goto(`/en/admin/reports/${second}`);
    await expect(staff.page.getByRole("button", { name: "Hide", exact: true })).toHaveCount(0);
    const inEffect = staff.page.getByRole("button", { name: "Hide (already hidden)" });
    await waitForHydration(inEffect);
    await inEffect.click();
    const closeDialog = staff.page.getByRole("dialog", { name: "Close the report: already hidden" });
    await closeDialog.getByLabel("Statement of reasons").fill("The profile was already hidden for the same claims.");
    await closeDialog.getByRole("button", { name: "Close as actioned" }).click();
    await expect(staff.page.getByText("The report is actioned. The item was already hidden", { exact: true })).toBeVisible();
    expect(query<{ n: number }>(`select count(*)::int as n from public.moderation_actions where target_id = ${literal(partner.id)}`)).toEqual([{ n: 1 }]);
    expect(query<{ in_effect: string }>(
      `select metadata ->> 'already_in_effect' as in_effect from audit.log where action = 'report.actioned' and entity_id = ${literal(String(second))}`,
    )).toEqual([{ in_effect: "true" }]);

    const secret = await enrollTotp(partner.user);
    await signInAtAal2(page, partner.user, secret, `/en/org/${partner.slug}/workforce-profile`);
    const notice = page.getByRole("status").filter({ hasText: "Hidden by moderation" });
    await expect(notice).toContainText("Your partner profile is not shown to anyone");
    await expect(notice).toContainText(reasons);
    await expect(notice).toContainText("you can appeal until");
    await expect(notice.getByRole("button", { name: "Appeal" })).toBeVisible();
    await expect(notice.getByRole("link", { name: "How to appeal" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.context().clearCookies();

    const member = await createCommittedUser("company");
    execute(`insert into public.organization_members (organization_id, user_id, role, accepted_at) values (${literal(partner.id)}, ${literal(member.id)}, 'member', now())`);
    await signInAtAal1(page, member, `/en/org/${partner.slug}/workforce-profile`);
    await expect(page.getByRole("status").filter({ hasText: "Hidden by moderation" })).toContainText(reasons);

    await staff.page.goto(`/en/admin/organizations/${partner.id}`);
    const section = staff.page.locator("#partner-profile");
    await expect(section).toContainText("Hidden");
    await expect(section.getByRole("table", { name: "Decisions on this partner, newest first" })).toContainText(`R-${String(id).padStart(6, "0")}`);
    await expectAccessibleAtBothWidths(staff.page);
    await staff.page.setViewportSize({ width: 1280, height: 900 });
    const show = section.getByRole("button", { name: "Show partner profile again" });
    await waitForHydration(show);
    await section.getByLabel("Statement of reasons").fill("The company refunded the worker and corrected its terms.");
    await show.click();
    await expect(staff.page.getByText("The partner profile is shown again", { exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: "Hide partner profile" })).toBeVisible();
    expect((await page.request.get(profileUrl(partner.slug))).status(), "shown again").toBe(200);
    await staff.context.close();
  });

  test("FR-S1 AC7: a suspension takes the profile and its listings out of the directories, and the reinstatement brings them back", async ({ page }) => {
    test.setTimeout(120_000);
    const partner = await listedPartner();
    await signInStaff(page, "trust_safety", `/en/admin/organizations/${partner.id}`);
    const standing = page.locator("#standing");
    const suspend = standing.getByRole("button", { name: "Suspend organisation" });
    await waitForHydration(suspend);
    await standing.getByLabel("Statement of reasons").fill("Fee demands from several workers were confirmed.");
    await suspend.click();
    await expect(page.getByText("The organisation is suspended", { exact: true })).toBeVisible();
    await expect(page.locator("#partner-profile")).toContainText("Hidden with the suspension");
    expect(query<{ moderation_state: string }>(`select moderation_state::text from public.organizations where id = ${literal(partner.id)}`)).toEqual([
      { moderation_state: "org_suspended" },
    ]);
    expect((await page.request.get(profileUrl(partner.slug))).status(), "suspended profile").toBe(404);
    const directory = await (await page.request.get("/en/partners/recruitment?destination=DE")).text();
    expect(directory).not.toContain(partner.displayName);
    expect(await (await page.request.get("/sitemap.xml")).text()).not.toContain(`/en/partners/${partner.slug}<`);

    const reinstate = standing.getByRole("button", { name: "Reinstate organisation" });
    await waitForHydration(reinstate);
    await standing.getByLabel("Statement of reasons").fill("The company refunded the workers and was reviewed again.");
    await reinstate.click();
    await expect(page.getByText("The organisation is reinstated", { exact: true })).toBeVisible();
    expect((await page.request.get(profileUrl(partner.slug))).status(), "reinstated profile").toBe(200);
    expect(await (await page.request.get("/sitemap.xml")).text()).toContain(`/en/partners/${partner.slug}<`);
  });
  test("FR-S1 AC4, AC7: Trust & Safety suspend the organisation of a reported vacancy by keyboard, and its vacancies leave the public", async ({ page }) => {
    const company = await newCompany();
    const job = seedJob(company, { title: `Suspended ${uniqueName("Welder")}`, status: "open" });
    const id = Number(execute(
      `insert into public.reports (target_type, job_id, organization_id, category, details, good_faith_confirmed)
       values ('company', ${literal(job)}, ${literal(company.id)}, 'discrimination', 'Every vacancy of this company excludes women.', true) returning id`,
    ).trim().split("\n")[0]);
    await signInStaff(page, "trust_safety", `/en/admin/reports/${id}`);
    await expect(page.getByRole("button", { name: "Hide", exact: true })).toHaveCount(0);
    const suspend = page.getByRole("button", { name: "Suspend organisation" });
    await waitForHydration(suspend);
    await suspend.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Suspend the organisation" });
    await expect(dialog).toContainText(`Organisation:${displayName(company.id)}`);
    await page.keyboard.type("Discriminatory wording in every vacancy of the company.");
    await expect(dialog.getByLabel("Statement of reasons")).toBeFocused();
    await dialog.getByRole("button", { name: "Suspend organisation" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("The organisation is suspended. The report is actioned", { exact: true })).toBeVisible();
    await expect(page.locator("#decision")).toContainText("Organisation suspended");
    await expectAccessibleAtBothWidths(page);
    expect(query<{ status: string; state: string }>(
      `select o.status::text as status, j.moderation_state::text as state from public.organizations o join public.jobs j on j.organization_id = o.id where j.id = ${literal(job)}`,
    )).toEqual([{ status: "suspended", state: "org_suspended" }]);
    expect(query<{ report_id: number }>(`select report_id from public.moderation_actions where target_id = ${literal(company.id)} order by id desc limit 1`)).toEqual([{ report_id: id }]);
    expect((await page.request.get(`/en/jobs/${job}`)).status()).toBe(404);
  });

  test("FR-S1 AC9, AC11, AC12: the owner appeals the hidden profile from the badge, the decider cannot decide it, a second reviewer reverses it", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const partner = await listedPartner();
    const reasons = "The profile claims placements in Germany that the company never made.";
    const grounds = "Every placement on our profile is documented with signed contracts we can send.";
    const outcome = "The contracts confirm the placements, so the profile meets the rules.";

    const decider = await newVisitor(browser);
    await signInStaff(decider.page, "trust_safety", `/en/admin/organizations/${partner.id}`);
    const section = decider.page.locator("#partner-profile");
    const hide = section.getByRole("button", { name: "Hide partner profile" });
    await waitForHydration(hide);
    await section.getByLabel("Statement of reasons").fill(reasons);
    await hide.click();
    await expect(decider.page.getByText("The partner profile is hidden", { exact: true })).toBeVisible();
    const [{ id: decision }] = query<{ id: number }>(
      `select id from public.moderation_actions where target_type = 'partner_profile' and target_id = ${literal(partner.id)} and action = 'content_hidden'`,
    );

    // A member reads the badge and the reasons, and who can appeal, without the button.
    const member = await createCommittedUser("company");
    execute(`insert into public.organization_members (organization_id, user_id, role, accepted_at) values (${literal(partner.id)}, ${literal(member.id)}, 'member', now())`);
    const memberContext = await newVisitor(browser);
    await signInAtAal1(memberContext.page, member, `/en/org/${partner.slug}/workforce-profile`);
    const memberNotice = memberContext.page.getByRole("status").filter({ hasText: "Hidden by moderation" });
    await expect(memberNotice).toContainText(reasons);
    await expect(memberNotice).toContainText(`The owner or an admin of ${partner.displayName} can appeal this decision until`);
    await expect(memberNotice.getByRole("button", { name: "Appeal" })).toHaveCount(0);

    // The owner appeals from the badge by keyboard.
    const secret = await enrollTotp(partner.user);
    await signInAtAal2(page, partner.user, secret, `/en/org/${partner.slug}/workforce-profile`);
    const notice = page.getByRole("status").filter({ hasText: "Hidden by moderation" });
    const appeal = notice.getByRole("button", { name: "Appeal" });
    await waitForHydration(appeal);
    await appeal.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Appeal the decision" });
    await expect(dialog).toContainText(`Partner profile hidden: ${partner.displayName}`);
    await expect(dialog).toContainText("We aim to decide within 7 days");
    await expect(dialog.getByLabel("Grounds")).toBeFocused();
    await page.keyboard.type("Nineteen characters");
    await expect(dialog).toContainText("19 of 2000 characters used");
    await dialog.getByRole("button", { name: "Send appeal" }).click();
    await expect(dialog.getByText("Give grounds of at least 20 characters").first()).toBeVisible();
    await dialog.getByLabel("Grounds").fill(grounds);
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Send appeal" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Your appeal was sent. It is under review.", { exact: true })).toBeVisible();
    await expect(notice).toContainText("Appeal under review");
    await expect(notice.getByRole("button", { name: "Appeal" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    const [{ id: appealId, status, due }] = query<{ id: number; status: string; due: boolean }>(
      `select id, status::text, due_at = lodged_at + interval '7 days' as due from public.appeals where moderation_action_id = ${decision}`,
    );
    expect({ status, due }).toEqual({ status: "open", due: true });
    await memberContext.page.reload();
    await expect(memberContext.page.getByRole("status").filter({ hasText: "Hidden by moderation" })).toContainText("Appeal under review");
    await memberContext.context.close();

    // The decision page lists it for the organisation.
    await page.goto("/en/appeals");
    await expect(page.getByRole("link", { name: `Partner profile hidden: ${partner.displayName}` })).toHaveAttribute("href", `/en/appeals/${decision}`);
    await expect(page.getByRole("listitem").filter({ hasText: partner.displayName })).toContainText("Appeal under review");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // The decider reads the appeal but cannot decide it; the Platform Administrator reads it only.
    await decider.page.goto("/en/admin/appeals");
    const row = decider.page.getByRole("row").filter({ hasText: partner.displayName });
    await expect(row).toContainText("Appeal under review");
    await decider.page.setViewportSize({ width: 800, height: 900 });
    const lines = await row.getByText("Appeal under review", { exact: true }).evaluate((badge) => {
      const style = getComputedStyle(badge);
      const content = badge.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      return Math.round(content / parseFloat(style.lineHeight));
    });
    expect(lines, "the status badge stays on one line at 800 px").toBe(1);
    await expectAccessibleAtBothWidths(decider.page);
    await decider.page.setViewportSize({ width: 1280, height: 900 });
    await row.getByRole("link").click();
    await expect(decider.page).toHaveURL(`/en/admin/appeals/${appealId}`);
    await expect(decider.page.locator("#appeal")).toContainText(grounds);
    await expect(decider.page.locator("#decision")).toContainText(reasons);
    await expect(decider.page.locator("#outcome")).toContainText("You took this decision, so another Trust & Safety administrator decides the appeal.");
    await expect(decider.page.getByRole("button", { name: "Reverse the decision" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(decider.page);
    await decider.context.close();

    const admin = await newVisitor(browser);
    await signInStaff(admin.page, "admin", `/en/admin/appeals/${appealId}`);
    await expect(admin.page.locator("#outcome")).toContainText("Read only. Trust & Safety decide on appeals.");
    await admin.context.close();

    // Two second reviewers open it; one reverses by keyboard, the other is told it was decided.
    const late = await newVisitor(browser);
    await signInStaff(late.page, "trust_safety", `/en/admin/appeals/${appealId}`);
    const reviewer = await newVisitor(browser);
    await signInStaff(reviewer.page, "trust_safety", `/en/admin/appeals/${appealId}`);
    const reverse = reviewer.page.getByRole("button", { name: "Reverse the decision" });
    await waitForHydration(reverse);
    await reverse.focus();
    await reviewer.page.keyboard.press("Enter");
    const decide = reviewer.page.getByRole("dialog", { name: "Reverse the decision" });
    await expect(decide).toContainText("The partner profile is shown again");
    await expect(decide.getByLabel("Statement of reasons")).toBeFocused();
    await reviewer.page.keyboard.type(outcome);
    await expectNoAxeViolations(reviewer.page);
    await decide.getByRole("button", { name: "Reverse decision" }).focus();
    await reviewer.page.keyboard.press("Enter");
    await expect(reviewer.page.getByText("The decision is reversed", { exact: true })).toBeVisible();
    await expect(reviewer.page.locator("#outcome")).toContainText("Decision reversed");
    await expect(reviewer.page.locator("#outcome")).toContainText(outcome);

    const uphold = late.page.getByRole("button", { name: "Uphold the decision" });
    await waitForHydration(uphold);
    await uphold.click();
    const lateDialog = late.page.getByRole("dialog", { name: "Uphold the decision" });
    await lateDialog.getByLabel("Statement of reasons").fill("The claims were not backed by any document.");
    await lateDialog.getByRole("button", { name: "Uphold decision" }).click();
    await expect(lateDialog).toContainText("This appeal was decided by someone else, reload the page. It is now: Decision reversed.");
    await late.context.close();
    await reviewer.context.close();

    expect(query<{ status: string; state: string; actions: string; audits: number }>(
      `select a.status::text as status, o.moderation_state::text as state,
         (select string_agg(m.action, ',' order by m.id) from public.moderation_actions m where m.target_id = o.id) as actions,
         (select count(*)::int from audit.log l where l.action like 'appeal.%' and l.entity_id = a.id::text) as audits
       from public.appeals a join public.organizations o on o.id = a.organization_id where a.id = ${appealId}`,
    )).toEqual([{ status: "restored", state: "visible", actions: "content_hidden,content_unhidden", audits: 2 }]);
    expect(query<{ outcome: string; reasons: string; mandatory: boolean }>(
      `select payload ->> 'appeal_outcome' as outcome, payload ->> 'reasons' as reasons, mandatory from public.notifications
       where kind = 'moderation_decision' and user_id = ${literal(partner.user.id)} and payload ? 'appeal_id'`,
    )).toEqual([{ outcome: "restored", reasons: outcome, mandatory: true }]);
    expect((await page.request.get(profileUrl(partner.slug))).status(), "restored on appeal").toBe(200);

    await page.goto(`/en/appeals/${decision}`);
    await expect(page.locator("#appeal")).toContainText("Decision reversed");
    await expect(page.locator("#appeal")).toContainText(outcome);
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-S1 AC12: a hidden vacancy and a suspended organisation are appealed from the decision page their notices link to", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const company = await newCompany();
    const job = seedJob(company, { title: `Appealed ${uniqueName("Welder")}`, status: "open" });
    const staff = await newVisitor(browser);
    await signInStaff(staff.page, "trust_safety", `/en/admin/moderation/${job}`);
    const open = staff.page.getByRole("button", { name: "Hide this vacancy" });
    await waitForHydration(open);
    await open.click();
    const hideDialog = staff.page.getByRole("dialog", { name: "Hide a vacancy" });
    await hideDialog.getByLabel("Statement of reasons").fill("The vacancy asks candidates for a placement fee.");
    await hideDialog.getByRole("button", { name: "Hide vacancy" }).click();
    await expect(staff.page.getByText("The vacancy is hidden", { exact: true })).toBeVisible();
    const [{ id: hidden }] = query<{ id: number }>(`select id from public.moderation_actions where target_id = ${literal(job)} and action = 'job_hidden'`);
    expect(query<{ decision: number }>(
      `select (payload ->> 'moderation_action_id')::int as decision from public.notifications where kind = 'vacancy_hidden' and user_id = ${literal(company.owner.id)}`,
    )).toEqual([{ decision: hidden }]);

    const member = await addCompanyUser(company, "member");
    const memberContext = await newVisitor(browser);
    await signInAtAal1(memberContext.page, member, `/en/org/${company.slug}/jobs/${job}`);
    await expect(memberContext.page.getByRole("link", { name: "See the decision and appeal" })).toHaveAttribute("href", `/en/appeals/${hidden}`);
    await memberContext.page.getByRole("link", { name: "See the decision and appeal" }).click();
    await expect(memberContext.page.locator("#appeal")).toContainText(`The owner or an admin of ${displayName(company.id)} can appeal this decision until`);
    await expect(memberContext.page.getByRole("button", { name: "Appeal" })).toHaveCount(0);
    await memberContext.context.close();

    const secret = await enrollTotp(company.owner);
    await signInAtAal2(page, company.owner, secret, `/en/appeals/${hidden}`);
    await expect(page.locator("#decision")).toContainText("The vacancy asks candidates for a placement fee.");
    const appeal = page.getByRole("button", { name: "Appeal" });
    await waitForHydration(appeal);
    await appeal.click();
    const dialog = page.getByRole("dialog", { name: "Appeal the decision" });
    await dialog.getByLabel("Grounds").fill("The vacancy charges no fee; the text was misread.");
    await dialog.getByRole("button", { name: "Send appeal" }).click();
    await expect(page.getByText("Your appeal was sent. It is under review.", { exact: true })).toBeVisible();
    await expect(page.locator("#appeal")).toContainText("Appeal under review");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // The suspension of the organisation: its notice names the decision, and the owner of the suspended organisation appeals.
    await staff.page.goto(`/en/admin/organizations/${company.id}`);
    const standing = staff.page.locator("#standing");
    const suspend = standing.getByRole("button", { name: "Suspend organisation" });
    await waitForHydration(suspend);
    await standing.getByLabel("Statement of reasons").fill("Fee demands from several candidates were confirmed.");
    await suspend.click();
    await expect(staff.page.getByText("The organisation is suspended", { exact: true })).toBeVisible();
    await staff.context.close();
    const [{ id: suspended }] = query<{ id: number }>(
      `select id from public.moderation_actions where target_id = ${literal(company.id)} and action = 'organization_suspended'`,
    );
    expect(query<{ decision: number }>(
      `select (payload ->> 'moderation_action_id')::int as decision from public.notifications where kind = 'account_suspended' and user_id = ${literal(company.owner.id)}`,
    )).toEqual([{ decision: suspended }]);
    // The suspension signs the members out: the owner signs in again, reaches the decision from the suspended
    // organisation's page and appeals it.
    await page.context().clearCookies();
    await signInAtAal2(page, company.owner, secret, `/en/appeals/${suspended}`);
    await page.goto(`/en/org/${company.slug}/jobs`);
    await expect(page.getByRole("alert").filter({ hasText: "This organization is suspended" })).toBeVisible();
    await page.getByRole("link", { name: "See the decision and appeal" }).click();
    await expect(page).toHaveURL("/en/appeals");
    await page.getByRole("link", { name: `Organisation suspended: ${displayName(company.id)}` }).click();
    await expect(page).toHaveURL(`/en/appeals/${suspended}`);
    await expect(page.locator("#decision")).toContainText("Fee demands from several candidates were confirmed.");
    const suspendedAppeal = page.getByRole("button", { name: "Appeal" });
    await waitForHydration(suspendedAppeal);
    await suspendedAppeal.click();
    await page.getByRole("dialog", { name: "Appeal the decision" }).getByLabel("Grounds").fill("We never asked a candidate for any fee.");
    await page.getByRole("dialog", { name: "Appeal the decision" }).getByRole("button", { name: "Send appeal" }).click();
    await expect(page.locator("#appeal")).toContainText("Appeal under review");
    expect(query<{ n: number }>(`select count(*)::int as n from public.appeals where organization_id = ${literal(company.id)} and status = 'open'`)).toEqual([{ n: 2 }]);
  });
});
