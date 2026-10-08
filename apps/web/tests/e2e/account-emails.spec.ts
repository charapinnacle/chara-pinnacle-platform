import { expect, test } from "./support/test";
import type { Browser, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { confirmFromLink, userByEmail } from "./support/accounts";
import { alertText, fillLogin } from "./support/login-page";
import {
  createCommittedUser,
  emailedResetPath,
  LINK_EXPIRED,
  passwordLoginStatus,
  RESET_SENT,
  RESET_SUBJECT,
} from "./support/login";
import { extractLinks, messageCount, waitForMessage } from "./support/mailpit";
import { fillSignup, newEmail, PASSWORD, summary } from "./support/signup-page";

const NEW_PASSWORD = "Brand-New-Pw-14";
const INVALID_LINK = "This link is invalid or has expired.";
const SENDER = /^admin_email\s*=\s*"(.+)"$/m.exec(
  readFileSync(path.join(__dirname, "../../../../supabase/config.toml"), "utf8"),
)?.[1];

async function signUpWorker(page: Page, email: string): Promise<void> {
  await page.goto("/en/signup");
  await fillSignup(page, { kind: "worker", email, password: PASSWORD });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/en\/verify-email$/);
}

async function confirmationPath(email: string): Promise<string> {
  const message = await waitForMessage(email, { subject: "Confirm your CHARA account", timeoutMs: 60_000 });
  const link = extractLinks(message).find((url) => url.includes("/en/confirm-email?token_hash="));
  if (!link) throw new Error("The confirmation email has no link");
  return `${new URL(link).pathname}${new URL(link).search}`;
}

async function requestReset(page: Page, email: string): Promise<number> {
  await page.goto("/en/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill(email);
  const response = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toHaveText(RESET_SENT);
  return (await response).status();
}

async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test.describe("FR-I1: account emails through the mail catcher", () => {
  test("FR-I1 AC1: sign-up sends exactly one English confirmation from the configured sender, login waits for the link, the link confirms", async ({
    page,
  }) => {
    const email = newEmail();
    await signUpWorker(page, email);

    const message = await waitForMessage(email, { timeoutMs: 60_000 });
    await expect.poll(() => messageCount(email)).toBe(1);
    expect(message.To.map((to) => to.Address)).toEqual([email]);
    expect(message.From.Address).toBe(SENDER);
    expect(message.Subject).toBe("Confirm your CHARA account");
    expect(message.Text).toContain("Follow this link to confirm your email address");
    const links = extractLinks(message).filter((url) => url.includes("token_hash="));
    expect(links).toHaveLength(1);
    expect(new URL(links[0]).pathname).toBe("/en/confirm-email");
    expect(new URL(links[0]).searchParams.get("token_hash")).toMatch(/^(pkce_)?[a-f0-9]{20,}$/);

    await page.goto("/en/login");
    await fillLogin(page, email, PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(alertText(page)).toContainText("Confirm your email address before you log in.");
    await expect(page).toHaveURL(/\/en\/login$/);
    expect(userByEmail(email)[0].email_confirmed_at).toBeNull();

    await confirmFromLink(page, await confirmationPath(email));
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    expect(userByEmail(email)[0].email_confirmed_at).not.toBeNull();

    await page.context().clearCookies();
    await page.goto("/en/login");
    await fillLogin(page, email, PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/en\/(onboarding|dashboard\/worker)$/);
  });

  test("FR-I1 AC2: the reset email arrives once, its link sets a new password and the old one is refused", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await requestReset(page, user.email);

    const message = await waitForMessage(user.email, { subject: RESET_SUBJECT, timeoutMs: 60_000 });
    await expect.poll(() => messageCount(user.email)).toBe(1);
    expect(message.From.Address).toBe(SENDER);
    const links = extractLinks(message).filter((url) => url.includes("token_hash="));
    expect(links).toHaveLength(1);
    expect(new URL(links[0]).pathname).toBe("/en/reset-password");

    await page.goto(await emailedResetPath(user.email));
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);

    expect(await passwordLoginStatus(user, NEW_PASSWORD)).toBe(200);
    expect(await passwordLoginStatus(user, user.password)).toBe(400);
  });

  test("FR-I1 AC3: an address with an account and one without get the same answer and status, and only the first gets an email", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    const unknown = newEmail();

    const known = await requestReset(page, user.email);
    const missing = await requestReset(page, unknown);
    expect(known).toBe(missing);
    expect(await page.getByRole("status").innerText()).toBe(RESET_SENT);

    await waitForMessage(user.email, { subject: RESET_SUBJECT, timeoutMs: 60_000 });
    await page.waitForTimeout(1_500);
    expect(await messageCount(user.email)).toBe(1);
    expect(await messageCount(unknown)).toBe(0);
  });

  test("FR-I1 AC4: a confirmation link and a reset link that were opened once are refused the second time", async ({
    browser,
    page,
  }) => {
    const email = newEmail();
    await signUpWorker(page, email);
    const confirm = await confirmationPath(email);
    await confirmFromLink(page, confirm);
    await expect(page).toHaveURL(/\/en\/onboarding$/);

    const second = await freshPage(browser);
    await confirmFromLink(second.page, confirm);
    await expect(second.page.getByRole("heading", { name: INVALID_LINK })).toBeVisible();
    await expect(second.page.getByRole("button", { name: "Send a new link" })).toBeVisible();
    expect((await second.context.cookies()).filter((cookie) => /^sb-.*-auth-token/.test(cookie.name))).toEqual([]);
    expect(userByEmail(email)[0].email_confirmed_at).not.toBeNull();
    await second.context.close();

    const user = await createCommittedUser("worker");
    await requestReset(page, user.email);
    const reset = await emailedResetPath(user.email);
    const opened = await freshPage(browser);
    await opened.page.goto(reset);
    await opened.page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await opened.page.getByRole("button", { name: "Change password" }).click();
    await expect(opened.page).toHaveURL(/\/en\/dashboard\/worker$/);
    await opened.context.close();

    const again = await freshPage(browser);
    await again.page.goto(reset);
    await expect(again.page.getByRole("heading", { name: LINK_EXPIRED })).toBeVisible();
    await expect(again.page.getByRole("link", { name: "Request a new reset link" })).toBeVisible();
    await expect(again.page.getByLabel("New password", { exact: true })).toHaveCount(0);
    expect((await again.context.cookies()).filter((cookie) => /^sb-.*-auth-token/.test(cookie.name))).toEqual([]);
    expect(await passwordLoginStatus(user, NEW_PASSWORD)).toBe(200);
    expect(await passwordLoginStatus(user, user.password)).toBe(400);
    await again.context.close();
  });

  test("FR-I1 AC5: a second reset request inside the minimum interval sends nothing and asks the person to wait", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    await requestReset(page, user.email);
    await waitForMessage(user.email, { subject: RESET_SUBJECT, timeoutMs: 60_000 });

    await requestReset(page, user.email);
    await expect(page.getByText("Wait a minute before asking for another.")).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(await messageCount(user.email)).toBe(1);
  });

  test("FR-I1 AC11: when the confirmation email cannot be sent the form says so, keeps the address, clears the password and stays on sign-up", async ({
    page,
  }) => {
    const email = newEmail();
    const message = "We could not send the confirmation email. Your account was not created. Try again in a few minutes.";
    await page.route("**/en/signup", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 200,
            contentType: "text/x-component",
            body: `0:{"a":"$@1","f":"","b":"local"}\n1:${JSON.stringify({ message })}\n`,
          })
        : route.continue(),
    );
    await page.goto("/en/signup");
    await fillSignup(page, { kind: "worker", email, password: PASSWORD });
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(summary(page)).toContainText(message);
    await expect(page.getByLabel("Email address")).toHaveValue(email);
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
    await expect(page).toHaveURL(/\/en\/signup$/);
    expect(userByEmail(email)).toEqual([]);
  });
});
