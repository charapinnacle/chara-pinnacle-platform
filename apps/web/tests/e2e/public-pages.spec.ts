import { execute, literal, query } from "./support/db";
import { newCompany, seedJob } from "./support/jobs";
import { overflow } from "./support/login-page";
import { waitForHydration } from "./support/hydration";
import { uniqueToken } from "./support/organizations";
import { FOOTER_LABELS, HEADER_LABELS, legalPaths, openVacancyId, sitePaths } from "./support/public-pages";
import { expect, test } from "./support/test";

test.describe("the public pages without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("FR-H1 AC1: every public page opens for an anonymous visitor, server-rendered with one h1, a title and text", async ({
    page,
  }) => {
    const jobId = await openVacancyId();
    const paths = [...sitePaths(jobId), ...legalPaths()];
    expect(paths).toHaveLength(19);

    for (const path of paths) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      expect(response?.request().redirectedFrom(), path).toBeNull();
      expect(new URL(page.url()).pathname, path).toBe(path);
      await expect(page.locator("html"), path).toHaveAttribute("lang", "en");
      await expect(page.locator("h1"), path).toHaveCount(1);
      expect((await page.title()).trim(), path).not.toBe("");
      expect((await page.locator("main").innerText()).trim().length, path).toBeGreaterThanOrEqual(100);
    }
  });
});

test.describe("the public pages", () => {
  test("FR-H1 AC2: an address without a language goes to /en, and a legal page exists exactly when a published version of its slug exists", async ({
    page,
  }) => {
    const redirect = await page.request.get("/pricing", { maxRedirects: 0 });
    expect([307, 308]).toContain(redirect.status());
    expect(new URL(redirect.headers().location, "http://localhost:3100").pathname).toBe("/en/pricing");

    expect(query<{ n: number }>("select count(*)::int as n from public.legal_documents where slug in ('nope', 'verification-policy')")).toEqual([{ n: 0 }]);
    const token = uniqueToken().toLowerCase();
    const published = `e2e-published-${token}`;
    const unpublished = `e2e-unpublished-${token}`;
    const future = `e2e-future-${token}`;
    execute(
      `insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values
        (${literal(published)}, 1, 'Published notice', 'The text of the published notice.', 'The first text of the notice.', now() - interval '1 day'),
        (${literal(unpublished)}, 1, 'Unpublished notice', 'The text of the unpublished notice.', 'The first text of the notice.', null),
        (${literal(future)}, 1, 'Future notice', 'The text of the future notice.', 'The first text of the notice.', now() + interval '1 day')`,
    );
    try {
      const response = await page.goto(`/en/legal/${published}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Published notice", level: 1 })).toBeVisible();

      for (const path of [`/en/legal/${unpublished}`, `/en/legal/${future}`, "/en/legal/nope", "/en/legal/verification-policy", "/en/legal/Terms-Of-Service"]) {
        const missing = await page.goto(path);
        expect(missing?.status(), path).toBe(404);
        await expect(page.getByRole("heading", { name: "Page not found", level: 1 }), path).toBeVisible();
        await expect(page.getByRole("main").getByRole("link", { name: "Back to the home page" }), path).toHaveAttribute("href", "/en");
        const text = await page.locator("body").innerText();
        expect(text, path).not.toMatch(/^\s+at /m);
        expect(text, path).not.toMatch(/Error:|digest/);
      }
    } finally {
      execute(`delete from public.legal_documents where slug in (${[published, unpublished, future].map(literal).join(", ")})`);
    }
  });

  test("FR-H1 AC3: the header and the footer are the same on every public page and every link opens", async ({ page }) => {
    const jobId = await openVacancyId();
    const seen: { header: string[]; headerTargets: string[]; footer: string[]; footerTargets: string[] }[] = [];
    for (const path of ["/en/pricing", `/en/jobs/${jobId}`, "/en/legal/terms-of-service"]) {
      await page.goto(path);
      const header = page.getByRole("navigation", { name: "Main" }).getByRole("link");
      const footer = page.getByRole("contentinfo").getByRole("link");
      seen.push({
        header: await header.allInnerTexts(),
        headerTargets: await header.evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? "")),
        footer: await footer.allInnerTexts(),
        footerTargets: await footer.evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? "")),
      });
    }
    expect(seen[0].header).toEqual(HEADER_LABELS);
    expect(seen[0].footer).toEqual(FOOTER_LABELS);
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
    for (const target of [...seen[0].headerTargets, ...seen[0].footerTargets]) {
      expect(target, target).toMatch(/^\/en\//);
      const response = await page.request.get(target);
      expect(response.status(), target).toBe(200);
    }
  });

  test("FR-H1 AC5: the keyboard reaches the skip link, the main area, every header link and every footer link, each with a visible focus", async ({
    page,
  }) => {
    await page.goto("/en");
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    expect((await skipLink.boundingBox())?.width).toBeGreaterThan(100);
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();

    await page.goto("/en");
    await page.keyboard.press("Tab");
    const stops: { region: string; text: string; outlineStyle: string; boxShadow: string }[] = [];
    for (let press = 0; press < 80; press++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const style = getComputedStyle(element);
        const region = element.closest("main") ? "main" : element.closest("header") ? "header" : element.closest("footer") ? "footer" : "other";
        return { region, text: element.innerText.trim(), outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
      });
      stops.push(stop);
      if (stop.text === FOOTER_LABELS.at(-1)) break;
    }
    const inRegion = (region: string) => stops.filter((stop) => stop.region === region).map((stop) => stop.text);
    expect(inRegion("header")).toEqual(["CHARA", ...HEADER_LABELS]);
    expect(inRegion("footer")).toEqual(FOOTER_LABELS);
    const regions = stops.map((stop) => stop.region);
    expect(regions.lastIndexOf("header")).toBeLessThan(regions.indexOf("footer"));
    expect(regions).not.toContain("other");
    for (const stop of stops) {
      expect(stop.outlineStyle !== "none" || stop.boxShadow !== "none", `${stop.text} has a visible focus`).toBe(true);
    }
  });

  test("FR-H1 AC10: no cookie is set, no request leaves the app, and there is no cookie banner", async ({ browser }) => {
    const jobId = await openVacancyId();
    const context = await browser.newContext();
    const page = await context.newPage();
    const cookieHeaders: string[] = [];
    const foreign: string[] = [];
    page.on("response", async (response) => {
      if ((await response.allHeaders())["set-cookie"]) cookieHeaders.push(response.url());
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      const storage = request.resourceType() === "image" && url.port === "54421";
      if (url.origin !== "http://localhost:3100" && !storage) foreign.push(request.url());
    });
    try {
      for (const path of [...sitePaths(jobId), "/en/legal/cookie-policy"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await page.evaluate(() => document.cookie), path).toBe("");
        await expect(page.getByRole("dialog"), path).toHaveCount(0);
        await expect(page.getByRole("alertdialog"), path).toHaveCount(0);
        await expect(page.getByText(/we use cookies|accept (all )?cookies|cookie settings|cookie preferences/i), path).toHaveCount(0);
      }
      expect(cookieHeaders).toEqual([]);
      expect(foreign).toEqual([]);
      expect(await context.cookies()).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("FR-H1 AC11: Find Jobs lists only the open and visible vacancy, and the pages of the other seven are not found", async ({
    page,
  }) => {
    const company = await newCompany();
    const marker = `zq${uniqueToken()}`;
    const title = (label: string) => `${label} welder ${marker}`;
    const ids = {
      visible: seedJob(company, { title: title("Visible"), status: "open" }),
      hidden: seedJob(company, { title: title("Hidden"), status: "open", moderation: "hidden" }),
      suspended: seedJob(company, { title: title("Suspended"), status: "open", moderation: "org_suspended" }),
      paused: seedJob(company, { title: title("Paused"), status: "paused" }),
      closed: seedJob(company, { title: title("Closed"), status: "closed" }),
      filled: seedJob(company, { title: title("Filled"), status: "filled" }),
      draft: seedJob(company, { title: title("Draft"), status: "draft" }),
      deleted: seedJob(company, { title: title("Deleted"), status: "open" }),
    };
    execute(`update public.jobs set deleted_at = now() where id = ${literal(ids.deleted)}`);

    await page.goto(`/en/jobs?q=${marker}`);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([title("Visible")]);
    await expect(page.getByRole("link", { name: title("Visible") })).toHaveAttribute("href", `/en/jobs/${ids.visible}`);

    const statuses = Object.fromEntries(
      await Promise.all(Object.entries(ids).map(async ([label, id]) => [label, (await page.request.get(`/en/jobs/${id}`)).status()])),
    );
    expect(statuses).toEqual({ visible: 200, hidden: 404, suspended: 404, paused: 404, closed: 404, filled: 404, draft: 404, deleted: 404 });
  });
});

test.describe("the public pages at 360 px", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("FR-H1 AC6: no page scrolls sideways, and the menu opens with Enter and Space and closes with Escape", async ({ page }) => {
    const jobId = await openVacancyId();
    for (const path of sitePaths(jobId)) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(360);
      expect(await overflow(page), path).toBeLessThanOrEqual(0);
    }

    await page.goto("/en");
    const menu = page.getByRole("button", { name: "Menu" });
    const pricing = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" });
    await waitForHydration(menu);
    await expect(pricing).toBeHidden();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    for (const key of ["Enter", "Space"]) {
      await menu.focus();
      await page.keyboard.press(key);
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await expect(pricing).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Find Jobs" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await expect(menu).toBeFocused();
      await expect(pricing).toBeHidden();
    }

    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  test("FR-H1 AC6: a link of the menu opens its page and the menu is closed there", async ({ page }) => {
    await page.goto("/en");
    const menu = page.getByRole("button", { name: "Menu" });
    await waitForHydration(menu);
    await menu.click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "About" }).click();
    await expect(page.getByRole("heading", { name: "About CHARA", level: 1 })).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" })).toBeHidden();
  });
});
