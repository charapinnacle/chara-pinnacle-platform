import type { Page } from "@playwright/test";
import { signInStaff } from "./support/admin";
import { signedInPage } from "./support/app-shell";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { seedDocument } from "./support/documents";
import { createCommittedUser } from "./support/login";
import { newCompany } from "./support/jobs";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { seedAllButCv, signIn } from "./support/passport";
import { SITE } from "./support/seo";
import { expect, test } from "./support/test";

const DIRECTORIES = ["Recruitment partners", "Staffing partners"];
const AUDIENCES = ["Find jobs", "For employers", "For partners"];
const STILL_LATER = ["Find workers", "Request workers", "Find companies", "Workforce corridors", "Job orders"];
const UNRELEASED_PATHS = ["/en/job-orders", "/en/companies", "/en/find-workers", "/en/request-workers"];

function setRelease(key: "release_job_orders" | "release_find_workers", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = '${key}'`);
}

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Menu" });
  await expect(panel).toBeVisible();
  return panel;
}

const exploreLinks = (panel: ReturnType<Page["getByRole"]>) => panel.getByRole("navigation", { name: "Explore" }).getByRole("link");

// The release switches are set for the whole database while this file runs, so it is a project of its own that follows
// the other partner specs (playwright.config.ts), and the tests run one after the other.
test.describe("the public partner network pages (FR-L5)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => {
    setPartnerRelease(true);
    setRelease("release_job_orders", false);
    setRelease("release_find_workers", false);
  });
  test.afterAll(() => {
    setRelease("release_job_orders", false);
    setRelease("release_find_workers", false);
    setPartnerRelease(false);
  });

  test("AC1: at 360 px the Menu links both directories in Explore and keeps the unreleased items as text that Tab never reaches", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/en");
    const panel = await openMenu(page);
    await expect(exploreLinks(panel)).toHaveText([...AUDIENCES, ...DIRECTORIES]);
    await expect(exploreLinks(panel).filter({ hasText: "Recruitment partners" })).toHaveAttribute("href", "/en/partners/recruitment");
    await expect(exploreLinks(panel).filter({ hasText: "Staffing partners" })).toHaveAttribute("href", "/en/partners/staffing");
    // Written in sentence case, drawn in Title Case (PR #110).
    expect(await exploreLinks(panel).filter({ hasText: "Recruitment partners" }).innerText()).toBe("Recruitment partners");
    const later = panel.getByRole("list", { name: "Coming in a later phase" });
    await expect(later.getByRole("listitem")).toHaveText(STILL_LATER);
    await expect(later.locator("a, [href], [tabindex]")).toHaveCount(0);
    await expect(later.getByRole("link")).toHaveCount(0);

    const reached: string[] = [];
    for (let press = 0; press < 16; press++) {
      await page.keyboard.press("Tab");
      reached.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""));
    }
    for (const label of DIRECTORIES) expect(reached).toContain(label);
    for (const label of STILL_LATER) expect(reached).not.toContain(label);
    await expectNoAxeViolations(page);

    await exploreLinks(panel).filter({ hasText: "Staffing partners" }).click();
    await expect(page).toHaveURL("/en/partners/staffing");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("AC1, PR #111: a worker's Menu offers no directory, a company's and a partner's offer both", async ({ browser }) => {
    const phone = { viewport: { width: 360, height: 800 } };
    const worker = await signedInPage(browser, await createCommittedUser("worker"), phone);
    // Signed in, the home page leads to the dashboard, so the Menu is read on another public page.
    await worker.page.goto("/en");
    await expect(worker.page).toHaveURL("/en/dashboard/worker");
    await worker.page.goto("/en/how-it-works");
    await openMenu(worker.page);
    await expect(exploreLinks(worker.page.getByRole("dialog", { name: "Menu" }))).toHaveText(["Find jobs"]);
    await worker.page.keyboard.press("Escape");
    await expect(worker.page.getByRole("main").getByRole("heading", { name: "For employers" })).toBeVisible();
    await expect(worker.page.getByRole("main").getByRole("link", { name: "Recruitment partners" })).toHaveCount(0);
    await worker.context.close();

    const company = await newCompany();
    const employer = await signedInPage(browser, company.owner, phone);
    await employer.page.goto("/en/how-it-works");
    await expect(exploreLinks(await openMenu(employer.page))).toHaveText(["For employers", "For partners", ...DIRECTORIES]);
    await employer.context.close();

    const { user } = await partnerWithCompany("staffing_company");
    const partner = await signedInPage(browser, user, phone);
    await partner.page.goto("/en/how-it-works");
    await expect(exploreLinks(await openMenu(partner.page))).toHaveText(["For employers", "For partners", ...DIRECTORIES]);
    await partner.page.keyboard.press("Escape");
    await expect(partner.page.getByRole("link", { name: "Sign up as a staffing company" })).toHaveCount(0);
    await partner.context.close();
  });

  test("AC3: the pages of 2b and 2c do not exist and neither the sitemap nor the menu names them; with their switches on only the pages built so far (Job orders, V40; Find companies, V53; Find workers, V69) appear", async ({ request }) => {
    for (const path of UNRELEASED_PATHS) expect((await request.get(path)).status(), path).toBe(404);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    for (const path of ["/en/partners/recruitment", "/en/partners/staffing", "/en/for-partners"]) expect(sitemap).toContain(`<loc>${SITE}${path}</loc>`);
    for (const path of UNRELEASED_PATHS) expect(sitemap).not.toContain(`<loc>${SITE}${path}</loc>`);

    // Their switches alone publish nothing: each page's own unit adds its link and sitemap entry (job-orders.spec.ts
    // checks the Job orders page, its link and its entry, find-employers.spec.ts the Find companies page,
    // find-workers.spec.ts the Find workers page).
    const built = ["/en/job-orders", "/en/companies", "/en/find-workers"];
    const notBuilt = UNRELEASED_PATHS.filter((path) => !built.includes(path));
    setRelease("release_job_orders", true);
    setRelease("release_find_workers", true);
    try {
      for (const path of notBuilt) expect((await request.get(path)).status(), path).toBe(404);
      for (const path of built) expect((await request.get(path)).status(), path).toBe(200);
      const switched = await (await request.get("/sitemap.xml")).text();
      for (const path of notBuilt) expect(switched).not.toContain(`<loc>${SITE}${path}</loc>`);
      const menu = await (await request.get("/en")).text();
      for (const path of notBuilt) expect(menu).not.toContain(`href="${path}"`);
    } finally {
      setRelease("release_job_orders", false);
      setRelease("release_find_workers", false);
    }

    setPartnerRelease(false);
    const off = await (await request.get("/sitemap.xml")).text();
    expect(off).not.toContain("/en/partners/recruitment</loc>");
    expect(off).not.toContain("/en/partners/staffing</loc>");
    expect(off).not.toContain("/en/for-partners</loc>");
    expect((await request.get("/en/for-partners")).status()).toBe(404);
    setPartnerRelease(true);
  });

  test("FR-Q4 AC7: the passport completeness takes the weights of release 2c only while release_find_workers is on", async ({ page }) => {
    const user = await createCommittedUser("worker");
    seedAllButCv(user.id);
    await seedDocument(user.id, { title: "My CV", object: false });
    await signIn(page, user);
    await expect(page.getByText("100% complete", { exact: true })).toBeVisible();

    setRelease("release_find_workers", true);
    try {
      await page.goto("/en/passport");
      await expect(page.getByText("90% complete", { exact: true })).toBeVisible();
      await expect(page.getByText("Next:")).toContainText("Training");
      await expect(page.getByText("Training: 5 points", { exact: true })).toBeAttached();
      await expect(page.getByText("Skills: 10 points", { exact: true })).toBeAttached();
      execute(
        `insert into public.worker_training (worker_user_id, course, year_completed) values (${literal(user.id)}, 'Electrical safety', 2020)`,
      );
      await page.goto("/en/dashboard/worker");
      await expect(page.getByText("95% complete", { exact: true })).toBeVisible();
      await expect(page.getByText("Next:")).toContainText("Employment history");
    } finally {
      setRelease("release_find_workers", false);
    }

    await page.reload();
    await expect(page.getByText("100% complete", { exact: true })).toBeVisible();
  });

  test("AC9, AC10: the header and home, How it works and For employers explain the partner network, the job orders without a link, with one h1 and no axe violation", async ({ page }) => {
    await page.goto("/en");
    const home = page.getByRole("region", { name: "For recruitment and staffing companies" });
    await expect(home).toBeVisible();
    await expect(home.getByRole("link", { name: "Sign up as a recruitment company" })).toHaveAttribute("href", "/en/signup?kind=recruitment_company");
    await expect(home.getByRole("link", { name: "Sign up as a staffing company" })).toHaveAttribute("href", "/en/signup?kind=staffing_company");
    await expect(home.getByRole("link", { name: "See recruitment companies" })).toHaveAttribute("href", "/en/partners/recruitment");
    await expect(home.getByRole("link", { name: "See staffing companies" })).toHaveAttribute("href", "/en/partners/staffing");
    // The header adds For partners while release 2a is on.
    const header = page.getByRole("navigation", { name: "Main" });
    await expect(header.getByRole("link")).toHaveText([...AUDIENCES, "Sign in", "Post a job"]);
    await header.getByRole("link", { name: "For partners" }).click();
    await expect(page).toHaveURL("/en/for-partners");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("For recruitment and staffing companies");
    await expect(page.getByRole("main").getByRole("heading", { level: 3 })).toContainText(["Register", "Describe your company", "Get listed"]);
    await expect(page.getByRole("link", { name: "Sign up as a recruitment company" })).toHaveAttribute("href", "/en/signup?kind=recruitment_company");
    await expect(page.getByRole("link", { name: "Sign up as a staffing company" })).toHaveAttribute("href", "/en/signup?kind=staffing_company");
    await expectAccessibleAtBothWidths(page);
    await page.goto("/en");
    await expect(home.getByRole("link", { name: "How it works for partners" })).toHaveAttribute("href", "/en/for-partners");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expectAccessibleAtBothWidths(page);

    await page.goto("/en/how-it-works");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 2, name: "For recruitment and staffing companies" })).toBeVisible();
    await expect(main.getByText("Workforce requirements and job orders come in a later phase.")).toBeVisible();
    await expect(main.getByRole("link", { name: /job order/i })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Staffing partners" })).toHaveAttribute("href", "/en/partners/staffing");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expectAccessibleAtBothWidths(page);

    await page.goto("/en/employers");
    const partners = page.getByRole("region", { name: "Find recruitment and staffing partners." });
    await expect(partners.getByRole("link", { name: "Recruitment partners" })).toHaveAttribute("href", "/en/partners/recruitment");
    await expect(partners.getByRole("link", { name: "Staffing partners" })).toHaveAttribute("href", "/en/partners/staffing");
    await expect(partners).toContainText("no company pays to rank higher");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await partners.getByRole("link", { name: "Recruitment partners" }).click();
    await expect(page).toHaveURL("/en/partners/recruitment");
  });

  test("AC5, AC7: the pricing page shows the partner plans, lists a Phase 2 feature only while its release is on and makes no trust claim on a card", async ({ page }) => {
    await page.goto("/en/pricing");
    await expect(page.getByRole("tablist", { name: "Plans by type of company" }).getByRole("tab")).toHaveText([
      "Employers",
      "Recruitment companies",
      "Staffing companies",
    ]);
    const employers = page.getByRole("list", { name: "Employer plans" });
    await expect(employers).toContainText("Available workforce search");
    await page.getByRole("tab", { name: "Recruitment companies" }).click();
    const recruitment = page.getByRole("tabpanel", { name: "Recruitment companies" });
    await expect(recruitment).toContainText("countries served");
    await expect(recruitment).not.toContainText("Job order access");
    for (const claim of [/verified/i, /rank/i]) await expect(recruitment.getByRole("list", { name: "Recruitment company plans" })).not.toContainText(claim);
    await expectAccessibleAtBothWidths(page);

    setRelease("release_job_orders", true);
    await page.reload();
    await page.getByRole("tab", { name: "Recruitment companies" }).click();
    await expect(recruitment).toContainText("Job order access");
    setRelease("release_job_orders", false);
  });

  test("AC2: the console lists the five release switches, and release 2b is refused while its legal texts are drafts", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin/settings");
    const releases = page.getByRole("region", { name: "Release switches" });
    for (const key of ["release_partner_directories", "release_job_orders", "release_candidate_submissions", "release_messaging", "release_find_workers"]) {
      await expect(releases.getByRole("row").filter({ hasText: key })).toBeVisible();
    }
    const orders = releases.getByRole("row").filter({ hasText: "release_job_orders" });
    await expect(orders).toContainText("Release 2b: workforce requirements and job orders");
    await expect(orders).toContainText("not approved");
    await orders.getByRole("button", { name: /^Change/ }).click();
    const dialog = page.getByRole("dialog", { name: /Release 2b/ });
    await dialog.getByLabel("Value", { exact: true }).selectOption("true");
    await dialog.getByRole("textbox", { name: "Reason for the change" }).fill("Release 2b accepted by the client");
    await dialog.getByRole("button", { name: "Review change" }).click();
    await expect(dialog.getByText("The release cannot go live until these legal documents are approved:")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Switch the release on" })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Back" }).click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(query<{ v: string }>(`select value #>> '{}' as v from private.settings where key = 'release_job_orders'`)[0].v).toBe("false");
  });
});
