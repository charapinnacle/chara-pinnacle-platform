import type { Page, Response } from "@playwright/test";
import { COMPANY_PAGE_DESCRIPTION } from "@/lib/companies/page";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { setPartnerRelease } from "./support/partners";
import { readHead, robotsMeta, SITE } from "./support/seo";
import { signInBrowser } from "./support/session";
import { addMember, newTeam, signInAtAal2, type Team } from "./support/team";
import { expect, test } from "./support/test";

const NOT_AVAILABLE = "This company page is not available";
const LIVE = "Your company page is live";

const companyUrl = (slug: string) => `/en/companies/${slug}`;
const profileUrl = (slug: string) => `/en/org/${slug}/profile`;

type Company = Team & { displayName: string; legalName: string };

// An employer with its details in place (FR-K5 AC3): Construction, based in Germany, a description, a website and an
// identifier that must never reach the page.
async function employer({ pageOn = true }: { pageOn?: boolean } = {}): Promise<Company> {
  const team = await newTeam();
  execute(
    `update public.organizations set industry_code = 'F', based_in_country = 'DE', website = 'https://' || slug || '.example',
       description = 'We build steel halls in northern Germany.', legal_entity_identifier = 'DE987654321',
       legal_entity_identifier_kind = 'vat_number', public_page_enabled = ${pageOn}
     where id = ${literal(team.id)}`,
  );
  const [row] = query<{ display_name: string; legal_name: string }>(
    `select display_name, legal_name from public.organizations where id = ${literal(team.id)}`,
  );
  return { ...team, displayName: row.display_name, legalName: row.legal_name };
}

function pageEnabled(company: Company): boolean {
  return query<{ on: boolean }>(`select public_page_enabled as on from public.organizations where id = ${literal(company.id)}`)[0].on;
}

async function collectResponses(page: Page): Promise<() => Promise<string>> {
  const responses: Response[] = [];
  page.on("response", (response) => responses.push(response));
  return async () => (await Promise.all(responses.map((response) => response.text().catch(() => "")))).join("\n");
}

// The release switch is set for the whole database and the switch function is withdrawn for a moment, so this file is a
// project of its own that follows the other partner specs (playwright.config.ts), and its tests run one after the other.
test.describe("Public company page (FR-K5)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => {
    execute("grant execute on function public.set_company_page_visibility(uuid, boolean) to authenticated");
    setPartnerRelease(false);
  });

  test("AC1, AC2, AC9: the owner turns the page on with the keyboard and a failed change returns the switch", async ({ page }) => {
    test.setTimeout(120_000);
    const company = await employer({ pageOn: false });
    expect((await page.request.get(companyUrl(company.slug))).status(), "off by default").toBe(404);

    await signInAtAal2(page, company.owner, company.ownerSecret, profileUrl(company.slug));
    const toggle = page.getByRole("switch", { name: "Public company page" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toHaveAccessibleDescription(COMPANY_PAGE_DESCRIPTION);
    const section = page.getByRole("region", { name: "Company page" });
    const pageLink = section.getByRole("link", { name: "View your company page" });
    await expect(pageLink).toHaveCount(0);

    await toggle.focus();
    await page.keyboard.press("Space");
    const dialog = page.getByRole("dialog", { name: "Turn on your public company page?" });
    await expect(dialog).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog.getByRole("button", { name: "Turn on" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    const toast = page.getByRole("listitem").filter({ hasText: LIVE });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole("link", { name: "View your company page" })).toHaveAttribute("href", companyUrl(company.slug));
    await expect(pageLink, "the link stays next to the switch, not only in the toast").toHaveAttribute("href", companyUrl(company.slug));
    await toast.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(toast).toBeHidden();
    await expect(pageLink).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(pageEnabled(company)).toBe(true);
    const audit = query<{ metadata: { from: boolean; to: boolean } }>(
      `select metadata from audit.log where action = 'organization.public_page_changed' and entity_id = ${literal(company.id)}`,
    );
    expect(audit.map(({ metadata }) => metadata)).toEqual([{ from: false, to: true }]);
    expect((await page.request.get(companyUrl(company.slug))).status(), "on").toBe(200);

    execute("revoke execute on function public.set_company_page_visibility(uuid, boolean) from authenticated");
    try {
      await toggle.focus();
      await page.keyboard.press("Space");
      await expect(page.getByText("The company page was not changed", { exact: true })).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await expect(pageLink).toBeVisible();
      expect(pageEnabled(company)).toBe(true);
    } finally {
      execute("grant execute on function public.set_company_page_visibility(uuid, boolean) to authenticated");
    }
    await expectAccessibleAtBothWidths(page);

    await page.setViewportSize({ width: 1280, height: 900 });
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(page.getByText("Your company page is off", { exact: true })).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(pageLink).toHaveCount(0);
    expect(pageEnabled(company)).toBe(false);
    expect((await page.request.get(companyUrl(company.slug))).status(), "off again").toBe(404);
  });

  test("AC3, AC10: a visitor reads the details and the open vacancies only, and nothing private reaches the browser", async ({ page }) => {
    test.setTimeout(90_000);
    const company = await employer();
    const open = ["Crane operator", "Steel fixer", "Site welder"].map((title) => ({ title, id: seedJob(company, { title, status: "open" }) }));
    seedJob(company, { title: "Draft scaffolder", status: "draft" });
    seedJob(company, { title: "Paused scaffolder", status: "paused" });
    seedJob(company, { title: "Hidden scaffolder", status: "open", moderation: "hidden" });

    const received = await collectResponses(page);
    const response = await page.goto(companyUrl(company.slug));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(company.displayName);
    await expect(page.getByText("Construction · Based in Germany")).toBeVisible();
    await expect(page.getByText("We build steel halls in northern Germany.")).toBeVisible();
    await expect(page.getByRole("link", { name: /\.example/ })).toHaveAttribute("rel", "nofollow noopener noreferrer");

    const vacancies = page.getByRole("region", { name: "Open vacancies" });
    await expect(vacancies.getByRole("listitem")).toHaveCount(3);
    for (const { title, id } of open) {
      await expect(vacancies.getByRole("link", { name: title })).toHaveAttribute("href", `/en/jobs/${id}`);
    }
    await expect(page.locator("main")).not.toContainText("scaffolder");

    for (const secret of [company.legalName, "DE987654321", company.owner.email]) {
      expect((await page.content()).includes(secret), `"${secret}" leaked`).toBe(false);
      expect((await received()).includes(secret), `"${secret}" leaked`).toBe(false);
    }

    const head = await readHead(page);
    expect(head.title).toBe(`${company.displayName} - Construction company in Germany | Chara Pinnacle`);
    expect(head.canonical).toBe(`${SITE}/en/companies/${company.slug}`);
    await expect(robotsMeta(page)).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    const empty = await employer();
    await page.goto(companyUrl(empty.slug));
    await expect(page.getByRole("heading", { name: "No open vacancies right now" })).toBeVisible();
    await expect(robotsMeta(page)).toHaveAttribute("content", /noindex/);
    await expectAccessibleAtBothWidths(page);

    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`${SITE}/en/companies/${company.slug}<`);
    expect(sitemap).not.toContain(`/en/companies/${empty.slug}<`);
  });

  test("AC5: the vacancy page links the company only while the page is on", async ({ page }) => {
    const company = await employer();
    const jobId = seedJob(company, { title: "Linked welder", status: "open" });
    await page.goto(`/en/jobs/${jobId}`);
    const employerCard = page.getByRole("region", { name: company.displayName });
    await expect(employerCard.getByRole("link", { name: company.displayName })).toHaveAttribute("href", companyUrl(company.slug));
    await employerCard.getByRole("link", { name: company.displayName }).click();
    await expect(page).toHaveURL(companyUrl(company.slug));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(company.displayName);

    execute(`update public.organizations set public_page_enabled = false where id = ${literal(company.id)}`);
    await page.goto(`/en/jobs/${jobId}`);
    await expect(page.getByRole("heading", { level: 2, name: company.displayName })).toBeVisible();
    await expect(page.getByRole("link", { name: company.displayName })).toHaveCount(0);
    expect((await page.request.get(companyUrl(company.slug))).status()).toBe(404);
  });

  test("AC1, AC6: off, suspended, unknown and release off answer the same 404; reinstated is public again", async ({ page }) => {
    const unknown = await page.goto(companyUrl("no-such-company-anywhere"));
    expect(unknown?.status()).toBe(404);
    const unknownText = await page.locator("main").innerText();
    expect(unknownText).toContain(NOT_AVAILABLE);

    const off = await employer({ pageOn: false });
    const suspended = await employer();
    execute(`update public.organizations set status = 'suspended' where id = ${literal(suspended.id)}`);
    for (const [label, slug] of [["off", off.slug], ["suspended", suspended.slug]]) {
      const response = await page.goto(companyUrl(slug));
      expect(response?.status(), label).toBe(404);
      expect(await page.locator("main").innerText(), label).toBe(unknownText);
      await expect(robotsMeta(page)).toHaveAttribute("content", /noindex/);
    }
    execute(`update public.organizations set status = 'active' where id = ${literal(suspended.id)}`);
    expect((await page.request.get(companyUrl(suspended.slug))).status(), "reinstated").toBe(200);

    setPartnerRelease(false);
    try {
      expect((await page.request.get(companyUrl(suspended.slug))).status(), "release off").toBe(404);
    } finally {
      setPartnerRelease(true);
    }
  });

  test("AC8: the actions depend on the viewer and are reachable by Tab", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const company = await employer();

    await page.goto(companyUrl(company.slug));
    await expect(page.getByRole("link", { name: "Report company" })).toHaveAttribute(
      "href",
      `/en/report?type=content&path=${encodeURIComponent(companyUrl(company.slug))}`,
    );
    await expect(page.getByRole("link", { name: "Edit page" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: `Log in to follow ${company.displayName}` }), "FR-L4 AC9").toHaveAttribute(
      "href",
      `/en/login?next=${encodeURIComponent(companyUrl(company.slug))}`,
    );
    let reached = false;
    for (let step = 0; step < 40 && !reached; step++) {
      await page.keyboard.press("Tab");
      reached = (await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "")) === "Report company";
    }
    expect(reached).toBe(true);

    const worker = await createCommittedUser("worker");
    const member = (await addMember(company, "member")).user;
    for (const [label, user, report] of [["worker", worker, 1], ["member", member, 0]] as const) {
      const follow = report;
      const context = await browser.newContext();
      await signInBrowser(context, user);
      const viewerPage = await context.newPage();
      await viewerPage.goto(companyUrl(company.slug));
      await expect(viewerPage.getByRole("heading", { level: 1 })).toHaveText(company.displayName);
      await expect(viewerPage.getByRole("link", { name: "Report company" }), label).toHaveCount(report);
      await expect(viewerPage.getByRole("link", { name: "Edit page" }), label).toHaveCount(0);
      await expect(viewerPage.getByRole("switch"), label).toHaveCount(0);
      await expect(viewerPage.getByRole("button", { name: `Follow: ${company.displayName}` }), label).toHaveCount(follow);
      await context.close();
    }

    const admin = await addMember(company, "admin");
    if (!admin.secret) throw new Error("The admin has no factor");
    const context = await browser.newContext();
    const adminPage = await context.newPage();
    await signInAtAal2(adminPage, admin.user, admin.secret, profileUrl(company.slug));
    await adminPage.goto(companyUrl(company.slug));
    await expect(adminPage.getByRole("link", { name: "Edit page" })).toHaveAttribute("href", profileUrl(company.slug));
    await expect(adminPage.getByRole("switch", { name: "Public company page" })).toHaveAttribute("aria-checked", "true");
    await expect(adminPage.getByRole("link", { name: "Report company" })).toHaveCount(0);
    await expect(adminPage.getByRole("button", { name: /^Follow/ }), "no Follow of its own company").toHaveCount(0);
    await expect(adminPage.getByRole("link", { name: "View your company page" }), "no link to the page it is on").toHaveCount(0);
    await expectAccessibleAtBothWidths(adminPage);
    await context.close();
  });
});
