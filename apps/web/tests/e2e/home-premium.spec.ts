import type { Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { overflow } from "./support/login-page";
import { expect, test } from "./support/test";

const SECTION_HEADINGS = [
  "Who are you?",
  "One professional profile. Multiple opportunities.",
  "How Chara Pinnacle works",
  "Your Workforce. Your Network. One Platform.",
];

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
  page.locator("body > div > header").evaluate((header) => {
    const color = getComputedStyle(header).backgroundColor;
    const match = /(?:rgba|oklab|oklch|color)\(.*\/\s*([\d.]+)\)/.exec(color) ?? /rgba\([^)]*,\s*([\d.]+)\)/.exec(color);
    return match ? Number(match[1]) : 1;
  });

test.describe("the premium home page (U66)", () => {
  test("without JavaScript the whole page is served and visible: every band, the trust strip, the figures of the footer", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/en");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
    for (const heading of SECTION_HEADINGS) await expect(main.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    for (const text of ["Workers never pay", "Documents private by default", "Data stored in the EU", "Two-step verification for employer admins"]) {
      await expect(main.getByText(text)).toBeVisible();
    }
    await expect(page.locator('[data-reveal="pending"]')).toHaveCount(0);
    const opacities = await page.locator("[data-reveal]").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity));
    expect(opacities.length).toBeGreaterThanOrEqual(5);
    expect(new Set(opacities)).toEqual(new Set(["1"]));
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "All legal documents" })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await context.close();
  });

  test("under reduced motion nothing is hidden, nothing animates, the header is solid, and axe measures every band", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/en");
    await expect(page.locator("main header h1")).toBeVisible();
    // Asserts that nothing happens: the observer would have marked a band by now, so the time is the point of the check.
    await page.waitForTimeout(500);
    expect(await page.locator('[data-reveal="pending"]').count()).toBe(0);
    const durations = await page.locator(".journey-line, .journey-current, .passport-ring, main header h1 >> xpath=..").evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).animationDuration),
    );
    expect(durations.length).toBe(5);
    expect(new Set(durations)).toEqual(new Set(["1e-05s"]));
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
    expect(pending).toBeGreaterThanOrEqual(4);
    await expect(page.locator('[data-reveal="pending"]').first()).toHaveCSS("opacity", "0");
    const height = await page.evaluate(() => document.documentElement.scrollHeight);

    await scrollThrough(page);
    await expect(page.locator('[data-reveal="pending"]')).toHaveCount(0);
    await expect(page.locator('[data-reveal="shown"]')).toHaveCount(pending);
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.timeline === document.timeline && animation.playState === "running").length))
      .toBe(0);
    for (const opacity of await page.locator("[data-reveal]").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity))) {
      expect(opacity).toBe("1");
    }
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    const shifted = await page.evaluate(() => (window as unknown as { shifts: number[] }).shifts.reduce((sum, value) => sum + value, 0));
    expect(shifted).toBeLessThan(0.01);
    await expectNoAxeViolations(page);
  });

  test("from 768 px the header lies transparent over the dark hero and turns solid when the page is scrolled or the menu is open; below it is solid and in the flow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/en");
    const header = page.locator("body > div > header");
    await expect(header).toHaveCSS("position", "fixed");
    expect(await alpha(page)).toBe(0);
    await page.evaluate(() => window.scrollTo(0, 700));
    await expect.poll(() => alpha(page)).toBeGreaterThan(0.9);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Find Jobs" })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 800, height: 800 });
    await expect.poll(() => alpha(page)).toBe(0);
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(header).toHaveCSS("position", "static");
    expect(await alpha(page)).toBe(1);
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Find Jobs" })).toBeVisible();
    await page.setViewportSize({ width: 800, height: 800 });
    await expect.poll(() => alpha(page)).toBeGreaterThan(0.9);
  });

  test("without JavaScript on a phone the header stays in the flow above the headline and scrolls away", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await page.goto("/en");
    const header = page.locator("body > div > header");
    await expect(header).toHaveCSS("position", "static");
    const box = await header.boundingBox();
    const h1 = await page.locator("main header h1").boundingBox();
    expect(h1?.y ?? 0).toBeGreaterThanOrEqual((box?.y ?? 0) + (box?.height ?? 0));
    await page.evaluate(() => window.scrollTo(0, 600));
    expect((await header.boundingBox())?.y ?? 0).toBeLessThan(0);
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
    await expect(page.locator("body > div > header")).toHaveCSS("position", "static");
    expect(await alpha(page)).toBe(1);
  });

  test("the trust strip is one row of four short statements at a desktop width, in a grid of two at a tablet width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    const items = page.getByRole("list", { name: "" }).filter({ hasText: "Workers never pay" }).getByRole("listitem");
    await expect(items).toHaveText(["Workers never pay", "Documents private by default", "Data stored in the EU", "Two-step verification for employer admins"]);
    const tops = await items.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(await items.nth(1).evaluate((node) => getComputedStyle(node).borderInlineStartWidth)).toBe("1px");
    const strip = await page.getByRole("region", { name: "What you can rely on" }).boundingBox();
    const hero = await page.locator("main header").first().boundingBox();
    const who = await page.getByRole("heading", { level: 2, name: "Who are you?" }).boundingBox();
    expect(strip?.y ?? 0).toBeGreaterThanOrEqual((hero?.y ?? 0) + (hero?.height ?? 0) - 1);
    expect(strip?.y ?? Infinity).toBeLessThan(who?.y ?? 0);
    await page.setViewportSize({ width: 768, height: 900 });
    const rows = await items.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(rows).size).toBe(2);
  });

  test("the serif sets the display headings only: the controls and the running text stay in the sans, and only the home page loads it", async ({ page }) => {
    await page.goto("/en");
    const families = (selector: string) => page.locator(selector).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fontFamily));
    for (const family of await families("main h1, main h2")) expect(family).toMatch(/Newsreader/);
    for (const family of await families("main input, main button, main a, main li, main p:not(.font-serif), header a, footer a, footer p")) {
      expect(family).not.toMatch(/Newsreader/);
    }
    await expect.poll(() => page.evaluate(() => [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family).join(" "))).toMatch(/Newsreader/);
    // next/font announces its preloads in the Link header of the response.
    const fonts = async (path: string): Promise<string[]> =>
      ((await page.request.get(path)).headers().link ?? "").match(/<\/_next\/static\/media\/[^>]+\.woff2>/g) ?? [];
    const onHome = await fonts("/en");
    const onPricing = await fonts("/en/pricing");
    expect(onHome.length).toBe(onPricing.length + 1);
    expect(onHome.filter((href) => !onPricing.includes(href))).toHaveLength(1);
  });

  test("the largest paint is text, no picture sits on the critical path, and no style attribute or blocked resource appears", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text());
    });
    await page.addInitScript(() => {
      Object.assign(window, { paints: [] as { tag: string; time: number }[] });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { element: Element | null; startTime: number }[]) {
          (window as unknown as { paints: { tag: string; time: number }[] }).paints.push({ tag: entry.element?.tagName ?? "", time: entry.startTime });
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await page.goto("/en", { waitUntil: "networkidle" });
    await scrollThrough(page);
    const paints = await page.evaluate(() => (window as unknown as { paints: { tag: string; time: number }[] }).paints);
    const last = paints.at(-1);
    expect(last?.tag).not.toBe("IMG");
    expect(last?.time ?? Infinity).toBeLessThan(2500);
    await expect(page.locator("img")).toHaveCount(0);
    expect(await (await page.request.get("/en")).text()).not.toMatch(/\sstyle=/);
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

  test("a keyboard user sees a 2 px focus ring on the hero search, the light panel, the dark panel and the footer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    const ring = (locator: ReturnType<Page["getByRole"]>) =>
      locator.evaluate((node) => {
        const style = getComputedStyle(node);
        return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
      });
    const rings = [];
    for (const target of [
      page.getByRole("search").getByLabel("Keyword"),
      page.getByRole("link", { name: "I'm a worker" }),
      page.getByRole("link", { name: "I'm an employer" }),
      page.getByRole("link", { name: "Join Chara Pinnacle" }),
      page.getByRole("contentinfo").getByRole("link", { name: "Pricing" }),
    ]) {
      await target.focus();
      await expect(target).toBeFocused();
      // A field fades its outline colour in over 150 ms.
      await expect.poll(() => target.evaluate((node) => node.getAnimations().length)).toBe(0);
      const found = await ring(target);
      expect(found.style).toBe("solid");
      expect(found.width).toBe("2px");
      rings.push(found.color);
    }
    // The bronze on the white pill and the light panel, the gold on the dark panel, the dark band and the footer.
    expect(rings[0]).toBe(rings[1]);
    expect(rings[1]).not.toBe(rings[2]);
    expect(new Set([rings[2], rings[3], rings[4]]).size).toBe(1);
  });

  test("the panels and buttons lift a little on hover, and not at all under reduced motion", async ({ browser }) => {
    for (const [reducedMotion, expected] of [
      ["no-preference", "matrix(1, 0, 0, 1, 0, -2)"],
      ["reduce", "none"],
    ] as const) {
      const context = await browser.newContext({ reducedMotion, viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto("/en");
      const panel = page.getByRole("region", { name: "Worker", exact: true });
      await panel.scrollIntoViewIfNeeded();
      await panel.hover();
      if (reducedMotion === "reduce") {
        // Asserts that nothing happens: the lift would be over within 200 ms, so the time is the point of the check.
        await page.waitForTimeout(500);
      }
      await expect(panel).toHaveCSS("transform", expected);
      await context.close();
    }
  });

  test("the footer sets Platform, Company and Legal in three columns under the logo, with the copyright line", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("navigation", { name: "Footer" }).getByRole("list")).toHaveCount(3);
    for (const [title, links] of [
      ["Platform", ["Find Jobs", "How Chara Pinnacle works", "Pricing"]],
      ["Company", ["About", "Trust & Safety", "Contact"]],
      ["Legal", ["Imprint", "Privacy Policy", "Terms of Service", "Cookie Policy", "All legal documents"]],
    ] as const) {
      await expect(footer.getByRole("list", { name: title })).toBeVisible();
      await expect(footer.getByRole("list", { name: title }).getByRole("link")).toHaveText([...links]);
    }
    const lefts = await footer.getByRole("list").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(3);
    await expect(footer.getByText(`© ${new Date().getFullYear()} Chara Pinnacle`)).toBeVisible();
    await expect(footer.getByRole("heading")).toHaveCount(0);
  });
});
