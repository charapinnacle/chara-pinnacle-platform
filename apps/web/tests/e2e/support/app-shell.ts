import type { Browser, BrowserContext, BrowserContextOptions, Locator, Page } from "@playwright/test";
import { waitForHydration } from "./hydration";
import { signInBrowser } from "./session";
import { expect, visitorAddress } from "./test";
import type { TestUser } from "./test-user";

export const accountButton = (page: Page): Locator => page.getByRole("button", { name: "Account" });

export const mainNavigation = (page: Page): Locator => page.getByRole("navigation", { name: "Main" });

export const breadcrumbs = (page: Page): Locator => page.getByRole("navigation", { name: "Breadcrumb" });

// The account menu of the header; below 768 px the same items are in the mobile menu, which this does not open.
export async function openAccountMenu(page: Page): Promise<void> {
  const button = accountButton(page);
  await waitForHydration(button);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

export async function logOut(page: Page): Promise<void> {
  await openAccountMenu(page);
  await page.getByRole("button", { name: "Log out" }).click();
}

export async function linkLabels(navigation: Locator): Promise<string[]> {
  return navigation.getByRole("link").allInnerTexts();
}

// A browser of its own, already signed in at aal1, with the options of a phone or a touch screen when the test wants them.
export async function signedInPage(
  browser: Browser,
  user: TestUser,
  options: BrowserContextOptions = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": visitorAddress() }, ...options });
  await signInBrowser(context, user);
  return { context, page: await context.newPage() };
}

export const PHONE = { viewport: { width: 375, height: 812 } } as const;
