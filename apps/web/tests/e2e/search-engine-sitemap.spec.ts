import type { APIRequestContext, Page } from "@playwright/test";
import { execute, literal, query } from "./support/db";
import { addCompanyUser, jobUrl, newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { legalPaths } from "./support/public-pages";
import { SITE } from "./support/seo";
import { expect, test } from "./support/test";

// The sitemap lists every public vacancy of the database, so these tests compare it with the table: they have a project
// of their own that follows the others (playwright.config.ts), and run one after the other.
test.describe.configure({ mode: "serial" });

const STATIC_PATHS = ["/en", "/en/jobs", "/en/pricing", "/en/how-it-works", "/en/trust-safety", "/en/about", "/en/contact", "/en/imprint"];

interface Entry {
  loc: string;
  lastmod: string | null;
}

async function readSitemap(page: Page, request: APIRequestContext): Promise<Entry[]> {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("xml");
  const parsed = await page.evaluate((text) => {
    const document = new DOMParser().parseFromString(text, "application/xml");
    return {
      valid: document.querySelector("parsererror") === null && document.documentElement.localName === "urlset",
      entries: [...document.querySelectorAll("url")].map((url) => ({
        loc: url.querySelector("loc")?.textContent ?? "",
        lastmod: url.querySelector("lastmod")?.textContent ?? null,
      })),
    };
  }, await response.text());
  expect(parsed.valid).toBe(true);
  return parsed.entries;
}

const vacancyEntries = (entries: Entry[]) => entries.filter((entry) => entry.loc.startsWith(`${SITE}/en/jobs/`));

function publicVacancies() {
  return query<{ id: string; day: string }>(
    `select id, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD') as day from public.jobs
     where status = 'open' and deleted_at is null and moderation_state = 'visible' order by id`,
  );
}

test.describe("robots.txt", () => {
  test("FR-H5 AC6: allows the site, disallows the private areas and names the sitemap", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const lines = (await response.text()).split("\n").map((line) => line.trim());

    expect(lines).toContain("User-Agent: *");
    expect(lines).toContain("Allow: /");
    for (const area of [
      "/en/dashboard",
      "/en/org",
      "/en/passport",
      "/en/applications",
      "/en/admin",
      "/en/onboarding",
      "/en/login",
      "/en/signup",
      "/en/verify-email",
      "/en/forgot-password",
      "/en/mfa",
      "/auth/",
      "/api/",
    ]) {
      expect(lines, area).toContain(`Disallow: ${area}`);
    }
    expect(lines).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
});

test.describe("sitemap.xml", () => {
  test("FR-H5 AC3: lists the eight pages, the ten legal pages and the open visible vacancies, and no other vacancy", async ({ page, request }) => {
    const company = await newCompany();
    const listed = [
      seedJob(company, { title: "Sitemap listed one", status: "open" }),
      seedJob(company, { title: "Sitemap listed two", status: "open" }),
    ];
    const hidden = [
      seedJob(company, { title: "Sitemap draft", status: "draft" }),
      seedJob(company, { title: "Sitemap paused", status: "paused" }),
      seedJob(company, { title: "Sitemap closed", status: "closed" }),
      seedJob(company, { title: "Sitemap filled", status: "filled" }),
      seedJob(company, { title: "Sitemap moderated", status: "open", moderation: "hidden" }),
      seedJob(company, { title: "Sitemap suspended", status: "open", moderation: "org_suspended" }),
      seedJob(company, { title: "Sitemap deleted", status: "open" }),
    ];
    execute(`update public.jobs set deleted_at = now() where id = ${literal(hidden[6])}`);

    const entries = await readSitemap(page, request);
    const vacancies = vacancyEntries(entries);
    expect(entries.filter((entry) => !vacancies.includes(entry)).map((entry) => entry.loc).sort()).toEqual(
      [...STATIC_PATHS, ...legalPaths()].map((path) => `${SITE}${path}`).sort(),
    );
    for (const entry of entries) expect(new URL(entry.loc).search, entry.loc).toBe("");

    const expected = publicVacancies();
    expect(vacancies.map((entry) => entry.loc).sort()).toEqual(expected.map(({ id }) => `${SITE}/en/jobs/${id}`).sort());
    for (const id of listed) expect(vacancies.map((entry) => entry.loc)).toContain(`${SITE}/en/jobs/${id}`);
    for (const id of hidden) expect(vacancies.map((entry) => entry.loc).join("\n")).not.toContain(id);
    for (const { id, day } of expected) {
      expect(vacancies.find((entry) => entry.loc.endsWith(id))?.lastmod, id).toBe(day);
    }
    expect(entries.filter((entry) => !vacancies.includes(entry)).every((entry) => entry.lastmod === null)).toBe(true);
  });

  test("FR-H5 AC4: a vacancy enters the sitemap when it is published and leaves it when it is paused or hidden, with no rebuild", async ({
    page,
    request,
  }) => {
    const company = await newCompany();
    const admin = await addCompanyUser(company, "admin");
    const id = seedJob(company, { title: "Sitemap follows the data", status: "draft" });
    const url = `${SITE}/en/jobs/${id}`;
    const isListed = async () => (await readSitemap(page, request)).some((entry) => entry.loc === url);

    expect(await isListed()).toBe(false);

    await logIn(page, admin, jobUrl(company.slug, id));
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Open" })).toBeVisible();
    expect(await isListed()).toBe(true);

    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Paused - not public" })).toBeVisible();
    expect(await isListed()).toBe(false);

    await page.getByRole("button", { name: "Reopen", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Open/ })).toBeVisible();
    expect(await isListed()).toBe(true);

    execute(`update public.jobs set moderation_state = 'hidden' where id = ${literal(id)}`);
    expect(await isListed()).toBe(false);
    execute(`update public.jobs set moderation_state = 'visible' where id = ${literal(id)}`);
    expect(await isListed()).toBe(true);
  });
});
