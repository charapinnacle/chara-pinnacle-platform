import type { Locator, Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { overflow } from "./support/login-page";
import { HOME_SECTION_HEADINGS } from "./support/public-pages";
import { expect, test } from "./support/test";

// The motion, the layout and the accessibility of the product home page (U70, OPEN_QUESTIONS.md D87); its content and its
// links are in home-product.spec.ts.
const header = (page: Page) => page.locator("body > div > header");
const search = (page: Page) => page.getByRole("search", { name: "Search jobs" });

async function scrollThrough(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let top = 0; top <= height; top += 300) {
    await page.evaluate(
      (y) =>
        new Promise<void>((resolve) => {
          window.scrollTo(0, y);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
      top,
    );
  }
}

const alpha = (page: Page) =>
  header(page).evaluate((element) => {
    const color = getComputedStyle(element).backgroundColor;
    const match = /(?:rgba|oklab|oklch|color)\(.*\/\s*([\d.]+)\)/.exec(color) ?? /rgba\([^)]*,\s*([\d.]+)\)/.exec(color);
    return match ? Number(match[1]) : 1;
  });

test.describe("the layout of the product home page (U70)", () => {
  test("without JavaScript the whole page is served and visible, nothing waits to rise in, and nothing overflows", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/en");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
    for (const heading of HOME_SECTION_HEADINGS) await expect(main.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    await expect(main.getByText("Vacancies are moderated")).toBeVisible();
    await expect(page.locator('[data-reveal="pending"]')).toHaveCount(0);
    const opacities = await page.locator("[data-reveal]").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity));
    expect(opacities.length).toBeGreaterThanOrEqual(6);
    expect(new Set(opacities)).toEqual(new Set(["1"]));
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "All legal documents" })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await context.close();
  });

  test("under reduced motion nothing is hidden, nothing animates, the header is solid, and axe passes at 1280 and 360 px", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/en");
    await expect(page.locator("main header h1")).toBeVisible();
    // Asserts that nothing happens: the observer would have marked a band by now, so the time is the point of the check.
    await page.waitForTimeout(500);
    expect(await page.locator('[data-reveal="pending"]').count()).toBe(0);
    expect(await page.locator("main header h1").locator("..").evaluate((node) => getComputedStyle(node).animationDuration)).toBe("1e-05s");
    expect(await alpha(page)).toBeGreaterThan(0.9);
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoAxeViolations(page);
    }
    await context.close();
  });

  test("the bands below the first screen rise in as they enter it, and the page never changes size or shifts", async ({ page }) => {
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
    await page.goto("/en");
    await expect(page.locator('[data-reveal="pending"]').first()).toBeAttached();
    const pending = await page.locator('[data-reveal="pending"]').count();
    expect(pending).toBeGreaterThanOrEqual(5);
    await expect(page.locator('[data-reveal="pending"]').first()).toHaveCSS("opacity", "0");
    const height = await page.evaluate(() => document.documentElement.scrollHeight);

    await scrollThrough(page);
    await expect(page.locator('[data-reveal="pending"]')).toHaveCount(0);
    await expect(page.locator('[data-reveal="shown"]')).toHaveCount(pending);
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.timeline === document.timeline && animation.playState === "running").length))
      .toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    const shifted = await page.evaluate(() => (window as unknown as { shifts: number[] }).shifts.reduce((sum, value) => sum + value, 0));
    expect(shifted).toBeLessThan(0.01);
    await expectNoAxeViolations(page);
  });

  test("from 768 px the 80 px header lies transparent over the photograph and turns solid when the page is scrolled or the menu is open; below it is solid and in the flow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/en");
    await expect(header(page)).toHaveCSS("position", "fixed");
    expect((await header(page).boundingBox())?.height).toBeGreaterThanOrEqual(80);
    expect(await alpha(page)).toBe(0);
    await page.evaluate(() => window.scrollTo(0, 700));
    await expect.poll(() => alpha(page)).toBeGreaterThan(0.9);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Find Jobs" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Post a Job" })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 800, height: 800 });
    await expect.poll(() => alpha(page)).toBe(0);
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(header(page)).toHaveCSS("position", "static");
    expect(await alpha(page)).toBe(1);
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(nav.getByRole("link", { name: "Find Jobs" })).toBeVisible();
    await page.setViewportSize({ width: 800, height: 800 });
    await expect.poll(() => alpha(page)).toBeGreaterThan(0.9);
  });

  test("without JavaScript on a phone the header stays in the flow above the headline and scrolls away", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await page.goto("/en");
    await expect(header(page)).toHaveCSS("position", "static");
    const box = await header(page).boundingBox();
    const h1 = await page.locator("main header h1").boundingBox();
    expect(h1?.y ?? 0).toBeGreaterThanOrEqual((box?.y ?? 0) + (box?.height ?? 0));
    await page.evaluate(() => window.scrollTo(0, 600));
    expect((await header(page).boundingBox())?.y ?? 0).toBeLessThan(0);
    await context.close();
  });

  test("on a phone the open menu is part of the page: axe passes and its last link can be scrolled to, even at 320 by 256 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/en");
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Find Jobs" })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.setViewportSize({ width: 320, height: 256 });
    const last = page.getByRole("navigation", { name: "Main" }).getByRole("link").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });

  test("other public pages keep the light header in the page flow", async ({ page }) => {
    await page.goto("/en/pricing");
    await expect(header(page)).toHaveCSS("position", "static");
    expect(await alpha(page)).toBe(1);
  });

  test("the serif sets the display headings only: the controls and the running text stay in the sans, and only the home page loads it", async ({ page }) => {
    await page.goto("/en");
    const families = (selector: string) => page.locator(selector).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fontFamily));
    for (const family of await families("main h1, main h2")) expect(family).toMatch(/Newsreader/);
    for (const family of await families("main input, main button, main h3, main li, main p:not(.font-serif), header a, footer a, footer p")) {
      expect(family).not.toMatch(/Newsreader/);
    }
    expect(await page.locator("#platform-statistics-heading, main h2").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fontWeight))).not.toContain("600");
    // next/font announces its preloads in the Link header of the response.
    const fonts = async (path: string): Promise<string[]> =>
      ((await page.request.get(path)).headers().link ?? "").match(/<\/_next\/static\/media\/[^>]+\.woff2>/g) ?? [];
    const onHome = await fonts("/en");
    const onPricing = await fonts("/en/pricing");
    expect(onHome.length).toBe(onPricing.length + 1);
  });

  test("the hero photograph is the one picture fetched at once and with high priority; every other is lazy; no style attribute or blocked resource", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text());
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/en", { waitUntil: "networkidle" });
    const html = await (await page.request.get("/en")).text();
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
    const preloads = (html.match(/<link [^>]*rel="preload"[^>]*>/g) ?? []).filter((tag) => tag.includes("hero-welder"));
    expect(preloads).toHaveLength(1);
    for (const part of [/as="image"/, /type="image\/webp"/, /fetchpriority="high"/i, /imagesrcset="\/images\/home\/hero-welder-640\.webp 640w, [^"]*2400w"/i, /imagesizes="100vw"/i]) {
      expect(preloads[0]).toMatch(part);
    }

    const images = page.locator("main img");
    const eager = await images.evaluateAll((nodes) => nodes.filter((node) => node.getAttribute("loading") !== "lazy").map((node) => node.getAttribute("src")));
    expect(eager).toEqual(["/images/home/hero-welder-1280.jpg"]);
    expect(await images.first().getAttribute("fetchpriority")).toBe("high");
    expect(await images.count()).toBe(9);
    for (const box of await images.evaluateAll((nodes) => nodes.map((node) => ({ alt: node.getAttribute("alt"), width: node.getAttribute("width"), height: node.getAttribute("height") })))) {
      expect(box.alt).toBe("");
      expect(Number(box.width)).toBeGreaterThan(0);
      expect(Number(box.height)).toBeGreaterThan(0);
    }
    const hero = await images.first().evaluate((node: HTMLImageElement) => ({ current: node.currentSrc, done: node.complete && node.naturalWidth > 0 }));
    expect(hero.done).toBe(true);
    expect(hero.current).toMatch(/\/images\/home\/hero-welder-\d+\.webp$/);
    const fetched = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => new URL(entry.name).pathname).filter((path) => path.startsWith("/images/home/")));
    // One file of the hero, the one its preload and its picture agree on (the Manufacturing tile shows the same photograph
    // at 640 px when the browser loads it ahead of the scroll), and never the JPEG where WebP is supported.
    expect(fetched.filter((path) => /hero-welder-(1280|1920|2400)\.webp$/.test(path))).toEqual([new URL(hero.current).pathname]);
    expect(fetched.filter((path) => path.endsWith(".jpg"))).toEqual([]);
    // The closing call, thousands of pixels below the first screen, waits (its 1920 px file is not the tiles' size).
    expect(fetched.some((path) => /construction-team-1920/.test(path))).toBe(false);
    expect(violations).toEqual([]);
  });

  test("the page fits from 320 to 1920 px without sideways scrolling", async ({ page }) => {
    for (const width of [320, 375, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/en");
      expect(await overflow(page), `${width} px`).toBeLessThanOrEqual(0);
      await expect(page.locator("main header h1")).toBeVisible();
    }
  });

  test("every link, button and field of the page is at least 44 px high on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/en");
    const small = await page.locator("main a, main button, main input, footer a, header button, header a").evaluateAll((nodes) =>
      nodes
        .map((node) => ({ name: (node.textContent || node.getAttribute("placeholder") || node.tagName).trim().slice(0, 30), height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width }))
        .filter(({ height, width }) => width > 0 && height > 0 && height < 43.5),
    );
    expect(small).toEqual([]);
  });

  test("a keyboard user sees a 2 px focus ring on the search, the industry tiles, the dark panel, the light panel and the footer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    const rings: string[] = [];
    for (const target of [
      search(page).getByLabel("Job title, skill or occupation"),
      page.getByRole("link", { name: "Create your passport" }),
      page.getByRole("region", { name: "Publish a vacancy and manage every applicant in one pipeline" }).getByRole("link", { name: "Post a Job" }),
      page.getByRole("link", { name: "Join Chara Pinnacle" }),
      page.getByRole("contentinfo").getByRole("link", { name: "Pricing" }),
      page.getByRole("region", { name: "Browse by industry" }).getByRole("link").first(),
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
    // The bronze on the white search bar and the light panel, the gold on the dark panel, the closing call, the footer and
    // the dark industry tiles.
    expect(rings[0]).toBe(rings[1]);
    expect(rings[1]).not.toBe(rings[2]);
    expect(new Set(rings.slice(2)).size).toBe(1);
  });

  test("the panels and buttons lift a little on hover, and not at all under reduced motion", async ({ browser }) => {
    for (const [reducedMotion, expected] of [
      ["no-preference", "matrix(1, 0, 0, 1, 0, -2)"],
      ["reduce", "none"],
    ] as const) {
      const context = await browser.newContext({ reducedMotion, viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto("/en");
      const button = page.getByRole("link", { name: "Create your passport" });
      await button.scrollIntoViewIfNeeded();
      await button.hover();
      if (reducedMotion === "reduce") {
        // Asserts that nothing happens: the lift would be over within 200 ms, so the time is the point of the check.
        await page.waitForTimeout(500);
      }
      await expect(button).toHaveCSS("transform", expected);
      await context.close();
    }
  });
});
