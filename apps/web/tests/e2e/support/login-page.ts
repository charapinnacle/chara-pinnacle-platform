import type { Page } from "@playwright/test";
import type { TestUser } from "./test-user";

export const SUSPENDED = "This account is suspended. See the email we sent you for the reasons.";

export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
}

export function loginResponse(page: Page) {
  return page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/en/login",
  );
}

export async function logIn(page: Page, user: TestUser, next?: string): Promise<void> {
  await page.goto(next ? `/en/login?next=${encodeURIComponent(next)}` : "/en/login");
  await fillLogin(page, user.email, user.password);
  await page.getByRole("button", { name: "Log in" }).click();
}

export function alertText(page: Page) {
  return page.getByRole("alert").filter({ hasText: "There is a problem" });
}

export async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
