import type { Locator, Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { overflow } from "./support/login-page";
import { HOME_SECTION_HEADINGS } from "./support/public-pages";
import { expect, test } from "./support/test";

// The layout, the type, the motion and the accessibility of the home page (U73, OPEN_QUESTIONS.md D90); its content and its
// links are in home-product.spec.ts.
const header = (page: Page) => page.locator("body > div > header");
const search = (page: Page) => page.getByRole("search", { name: "Search jobs" });

const headerLook = (page: Page) =>
  header(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return { position: style.position, background: style.backgroundColor, height: Math.round(element.getBoundingClientRect().height) };
  });

test.describe("the layout of the home page (U73)", () => {
  test("without JavaScript the whole page is served and visible, and nothing overflows", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/en");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
    for (const heading of HOME_SECTION_HEADINGS) await expect(main.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    await expect(main.getByRole("search", { name: "Search jobs" })).toBeVisible();
    await expect(main.getByRole("region", { name: "For employers" })).toBeVisible();
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "All legal documents" })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await context.close();
  });

  test("nothing animates on load, and axe passes at 1280 and 360 px under reduced motion", async ({ browser, page: moving }) => {
    const animated = (page: Page) =>
      page.locator("main *").evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const style = getComputedStyle(node);
            return style.animationName !== "none" && style.animationDuration !== "1e-05s";
          })
          .map((node) => `${node.tagName} ${node.className}`),
      );
    await moving.goto("/en");
    expect(await animated(moving)).toEqual([]);

    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/en");
    await expect(page.locator("main h1")).toBeVisible();
    expect(await animated(page)).toEqual([]);
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoAxeViolations(page);
    }
    await context.close();
  });

  test("nothing waits for the scroll: every section is visible at once and the page never shifts", async ({ page }) => {
    await page.addInitScript(() => {
      const shifts: number[] = [];
      Object.assign(window, { shifts });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) shifts.push(entry.value);
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/en", { waitUntil: "networkidle" });
    const opacities = await page.locator("main > section").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity));
    expect(opacities.length).toBeGreaterThanOrEqual(HOME_SECTION_HEADINGS.length + 1);
    expect(new Set(opacities)).toEqual(new Set(["1"]));
    await expect(page.locator("[data-reveal]")).toHaveCount(0);
    const shifted = await page.evaluate(() => (window as unknown as { shifts: number[] }).shifts.reduce((sum, value) => sum + value, 0));
    expect(shifted).toBeLessThan(0.01);
  });

  test("the header is the solid header of every public page, in the flow at every width", async ({ page }) => {
    await page.goto("/en/pricing");
    const pricing = await headerLook(page);
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/en");
      const home = await headerLook(page);
      expect(home.position, `${width} px`).toBe("static");
      expect(home.background, `${width} px`).toBe(pricing.background);
      await page.evaluate(() => window.scrollTo(0, 600));
      expect((await header(page).boundingBox())?.y ?? 0, `${width} px`).toBeLessThan(0);
    }
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto("/en");
    expect((await headerLook(page)).height).toBe(pricing.height);
  });

  test("on a phone the open menu panel passes axe and its last control can be scrolled to, even at 320 by 256 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/en");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Menu" });
    await expect(panel.getByRole("link", { name: "Find jobs" })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.setViewportSize({ width: 320, height: 256 });
    const last = panel.getByRole("link").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });

  test("one type family: the headings are the sans of the design system at 80 and 52 px on a wide desktop, 72 and 44 px at 1024 px, and no other font is loaded", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/en");
    const fonts = await page.locator("main h1, main h2, main h3, main p, main a, main button, main input").evaluateAll((nodes) => [...new Set(nodes.map((node) => getComputedStyle(node).fontFamily))]);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatch(/Geist/);
    const size = (selector: string) => page.locator(selector).evaluate((node) => `${getComputedStyle(node).fontSize} ${getComputedStyle(node).fontWeight}`);
    expect(await size("main h1")).toBe("80px 600");
    expect(await size("#home-how-heading")).toBe("52px 600");
    await page.setViewportSize({ width: 1024, height: 800 });
    expect(await size("main h1")).toBe("72px 600");
    expect(await size("#home-how-heading")).toBe("44px 600");
    await page.setViewportSize({ width: 375, height: 800 });
    expect(await size("main h1")).toBe("44px 600");
    expect(await size("#home-how-heading")).toBe("32px 600");
    // next/font announces its preloads in the Link header of the response.
    const preloads = async (path: string): Promise<string[]> =>
      ((await page.request.get(path)).headers().link ?? "").match(/<\/_next\/static\/media\/[^>]+\.woff2>/g) ?? [];
    expect(await preloads("/en")).toEqual(await preloads("/en/pricing"));
  });

  test("no photograph and no picture is loaded, no style attribute is written and nothing is blocked", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text());
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/en", { waitUntil: "networkidle" });
    await expect(page.locator("main img, main picture, main video")).toHaveCount(0);
    const html = await (await page.request.get("/en")).text();
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
    expect(html).not.toMatch(/rel="preload"[^>]*as="image"/);
    const images = await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => (entry as PerformanceResourceTiming).initiatorType === "img").length);
    expect(images).toBe(0);
    expect(violations).toEqual([]);
  });

  test("the page fits from 320 to 1920 px without sideways scrolling", async ({ page }) => {
    for (const width of [320, 375, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/en");
      expect(await overflow(page), `${width} px`).toBeLessThanOrEqual(0);
      await expect(page.locator("main h1")).toBeVisible();
    }
  });

  test("every link, button and field a visitor can reach is at least 44 px high on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/en");
    const small = await page.locator("main a, main button, main input, footer a, header button, header a").evaluateAll((nodes) =>
      nodes
        .filter((node) => !node.closest("[inert]"))
        .map((node) => ({ name: (node.textContent || node.getAttribute("placeholder") || node.tagName).trim().slice(0, 30), height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width }))
        .filter(({ height, width }) => width > 0 && height > 0 && height < 43.5),
    );
    expect(small).toEqual([]);
  });

  test("the hero is centred on the page column and the search is its dominant control, at least 64 px high and wider than the headline line", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/en");
    const centre = async (selector: string) => {
      const box = await page.locator(selector).first().boundingBox();
      return box ? Math.round(box.x + box.width / 2) : -1;
    };
    const middle = Math.round((await page.evaluate(() => document.documentElement.clientWidth)) / 2);
    for (const selector of ["main h1", 'main [role="search"]', "#home-heading ~ p"]) expect(Math.abs((await centre(selector)) - middle), selector).toBeLessThanOrEqual(1);
    const form = await search(page).boundingBox();
    expect(form?.height ?? 0).toBeGreaterThanOrEqual(64);
    const lead = await page.locator("#home-heading ~ p").first().boundingBox();
    expect(form?.width ?? 0).toBeGreaterThan(lead?.width ?? 0);
    await expect(search(page).getByRole("button", { name: "Search jobs" })).toHaveCSS("height", "56px");
  });

  test("the steps stand in three columns on a desktop under one dark rule each, and in one column on a phone", async ({ page }) => {
    const steps = page.getByRole("region", { name: "From profile to offer, in three steps." }).getByRole("listitem");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/en");
    const tops = await steps.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const rule = await steps.first().evaluate((item) => getComputedStyle(item).borderTopColor);
    expect(rule).toBe(await page.locator("body").evaluate((body) => getComputedStyle(body).color));
    await page.setViewportSize({ width: 375, height: 800 });
    const lefts = await steps.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(1);
  });

  test("a keyboard user sees a 2 px focus ring: bronze on the light page, gold on the near-black closing call and the footer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    const rings: string[] = [];
    for (const target of [
      search(page).getByLabel("Job title, skill or occupation"),
      page.getByRole("region", { name: "For employers" }).getByRole("link", { name: "Post a job", exact: true }),
      page.getByRole("link", { name: "Create your CHARA Passport" }),
      page.getByRole("link", { name: "Join Chara Pinnacle" }),
      page.getByRole("contentinfo").getByRole("link", { name: "Pricing" }),
    ] as Locator[]) {
      await target.focus();
      await expect(target).toBeFocused();
      // A field fades its outline colour in over 150 ms.
      await expect.poll(() => target.evaluate((node) => node.getAnimations().length)).toBe(0);
      const found = await target.evaluate((node) => {
        const style = getComputedStyle(node);
        return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
      });
      expect(found.style).toBe("solid");
      expect(found.width).toBe("2px");
      rings.push(found.color);
    }
    expect(new Set(rings.slice(0, 3)).size).toBe(1);
    expect(rings[3]).toBe(rings[4]);
    expect(rings[0]).not.toBe(rings[3]);
  });

  test("buttons and links do not move on hover: only their colour changes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/en");
    for (const name of ["Create your CHARA Passport", "Start hiring", "Join Chara Pinnacle"]) {
      const button = page.getByRole("main").getByRole("link", { name });
      await button.scrollIntoViewIfNeeded();
      await button.hover();
      await expect(button).toHaveCSS("transform", "none");
    }
  });
});
