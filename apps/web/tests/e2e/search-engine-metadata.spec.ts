import type { Page } from "@playwright/test";
import { execute, literal } from "./support/db";
import { createCommittedUser } from "./support/login";
import { DESCRIPTION, newCompany, seedJob } from "./support/jobs";
import { LEGAL_SLUGS, legalPaths, sitePaths } from "./support/public-pages";
import { NOINDEX, SITE, followDocuments, nameCompany, readHead, robotsMeta } from "./support/seo";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

const jsonLdScripts = (page: Page) => page.locator('script[type="application/ld+json"]');

async function openVacancy(title: string, options: { description?: string; createdAt?: string } = {}) {
  const company = await newCompany();
  const id = seedJob(company, { title, status: "open", ...options });
  return { company, id };
}

test.describe("metadata of the public pages", () => {
  test("FR-H5 AC1: each of the eight pages, the ten legal pages and a vacancy has a title, a description, a canonical address and Open Graph tags", async ({
    page,
  }) => {
    const { id } = await openVacancy("Metadata welder");
    const vacancy = `/en/jobs/${id}`;
    const staticPaths = sitePaths(id).filter((path) => path !== vacancy);
    const eighteen = [...staticPaths, ...legalPaths()];
    expect(eighteen).toHaveLength(18);

    const descriptions: string[] = [];
    for (const path of [...eighteen, vacancy, "/en/jobs?q=warehouse"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      const head = await readHead(page);
      const pathname = path.split("?")[0];

      expect(head.title.trim().length, `${path} title`).toBeGreaterThan(0);
      expect(head.title.length, `${path} title`).toBeLessThanOrEqual(60);
      expect(head.description?.length ?? 0, `${path} description`).toBeGreaterThan(0);
      expect(head.description?.length ?? 0, `${path} description`).toBeLessThanOrEqual(160);
      expect(head.canonical, `${path} canonical`).toBe(`${SITE}${pathname}`);
      expect(head.canonical, `${path} canonical`).not.toContain("?");
      expect(head.ogTitle, `${path} og:title`).toBe(head.title);
      expect(head.ogDescription, `${path} og:description`).toBe(head.description);
      if (eighteen.includes(path)) {
        expect(head.description?.length, `${path} description`).toBeGreaterThanOrEqual(50);
        descriptions.push(head.description ?? "");
      }
    }
    expect(new Set(descriptions).size).toBe(18);
    expect(LEGAL_SLUGS).toHaveLength(10);
  });

  test("FR-H5 AC2: a vacancy page names the vacancy and the employer, describes it with the first 155 characters of its text and ignores the query string in its canonical address", async ({
    page,
  }) => {
    const text = `${"Load trucks. ".repeat(30)}Operate a forklift in our warehouse.`.slice(0, 400).trim();
    expect(text.length).toBeGreaterThan(155);
    const { company, id } = await openVacancy("Warehouse Operator", { description: text });
    nameCompany(company, "Example Logistics");

    await page.goto(`/en/jobs/${id}?utm_source=x`);
    const head = await readHead(page);
    expect(head.title).toContain("Warehouse Operator");
    expect(head.title).toContain("Example Logistics");
    expect(head.title.length).toBeLessThanOrEqual(60);
    expect(head.description).toBe(text.slice(0, 155));
    expect(head.canonical).toBe(`${SITE}/en/jobs/${id}`);

    const long = await openVacancy("Senior Warehouse Operator and Forklift Driver for the Hamburg Centre");
    nameCompany(long.company, "Example Logistics and Freight");
    await page.goto(`/en/jobs/${long.id}`);
    const cut = await readHead(page);
    expect(cut.title).toHaveLength(60);
    expect(cut.title.startsWith("Senior Warehouse Operator and Forklift Driver")).toBe(true);
  });
});

test.describe("structured data of a vacancy", () => {
  test("FR-H5 AC8: an open vacancy carries one valid JobPosting, and no other public page carries one", async ({ page }) => {
    const { company, id } = await openVacancy("Warehouse Operator", { description: DESCRIPTION, createdAt: "'2026-09-01T10:00:00Z'" });
    nameCompany(company, "Example Logistics", "https://example.com");
    execute(`update public.jobs set published_at = '2026-09-04T08:00:00Z' where id = ${literal(id)}`);

    await page.goto(`/en/jobs/${id}`);
    await expect(jsonLdScripts(page)).toHaveCount(1);
    const posting = JSON.parse((await jsonLdScripts(page).textContent()) ?? "") as Record<string, unknown>;
    expect(posting).toEqual({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Warehouse Operator",
      description: DESCRIPTION,
      datePosted: "2026-09-01",
      hiringOrganization: { "@type": "Organization", name: "Example Logistics", sameAs: "https://example.com" },
      jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Hamburg", addressCountry: "DE" } },
      employmentType: "FULL_TIME",
    });
    expect(posting).not.toHaveProperty("validThrough");

    for (const path of [...sitePaths(id).filter((other) => other !== `/en/jobs/${id}`), ...legalPaths()]) {
      await page.goto(path);
      await expect(jsonLdScripts(page), path).toHaveCount(0);
      expect(await page.content(), path).not.toContain("JobPosting");
    }
  });

  test("FR-H5 AC11: a title that tries to close the script block runs nothing and is shown as text", async ({ page }) => {
    const hostile = "</script><script>window.hacked=1</script>";
    const { id } = await openVacancy(hostile);

    await page.goto(`/en/jobs/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(hostile);
    await expect(jsonLdScripts(page)).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined();
    const injected = await page.evaluate(() =>
      [...document.querySelectorAll("script")].filter((script) => script.textContent?.trim() === "window.hacked=1").length,
    );
    expect(injected).toBe(0);
    const markup = JSON.parse((await jsonLdScripts(page).textContent()) ?? "") as { title: string };
    expect(markup.title).toBe(hostile);
  });
});

test.describe("private pages are marked noindex", () => {
  const privatePaths = (slug: string, jobId: string) => [
    "/en/dashboard/worker",
    "/en/dashboard/employer",
    `/en/org/${slug}/jobs`,
    "/en/passport",
    "/en/applications",
    "/en/admin",
    "/en/onboarding",
    "/en/login",
    "/en/signup",
    "/en/verify-email",
    "/en/forgot-password",
    "/en/mfa",
    "/en/saved",
    "/en/settings",
    "/en/forbidden",
    `/en/jobs/${jobId}/apply`,
  ];

  test("FR-H5 AC7: an anonymous request is marked noindex on the redirect and on the page it ends at, and the public pages are not marked", async ({
    page,
  }) => {
    const { company, id } = await openVacancy("Noindex welder");

    for (const path of privatePaths(company.slug, id)) {
      const documents = await followDocuments(page, path);
      if (path === "/en/dashboard/worker") expect(documents.at(-1)?.url).toContain("/en/login");
      for (const document of documents) expect(document.robots, `${path} at ${document.url}`).toBe(NOINDEX);
    }

    const withoutLanguage = await followDocuments(page, "/dashboard");
    expect(withoutLanguage[0].url).toBe(`${SITE}/dashboard`);
    expect(withoutLanguage.length).toBeGreaterThan(1);
    for (const document of withoutLanguage) expect(document.robots, `/dashboard at ${document.url}`).toBe(NOINDEX);
    expect((await followDocuments(page, "/jobs"))[0].robots, "the redirect of a public path").toBeUndefined();

    for (const path of [...sitePaths(id), ...legalPaths()]) {
      const response = await page.goto(path);
      expect(response?.headers()["x-robots-tag"], path).toBeUndefined();
      await expect(robotsMeta(page), path).toHaveCount(0);
    }
  });

  test("FR-H5 AC7: a candidate and a company owner get noindex on every private page, including the page that says the role may not open it", async ({
    browser,
  }) => {
    const { company, id } = await openVacancy("Signed in welder");
    const worker = await createCommittedUser("worker");
    const signedIn = [
      ["candidate", worker],
      ["owner", company.owner],
    ] as const;

    for (const [role, user] of signedIn) {
      const context = await browser.newContext();
      await signInBrowser(context, user);
      const page = await context.newPage();
      for (const path of privatePaths(company.slug, id)) {
        for (const document of await followDocuments(page, path)) {
          expect(document.robots, `${role} ${path} at ${document.url}`).toBe(NOINDEX);
        }
      }
      await context.close();
    }
  });
});
