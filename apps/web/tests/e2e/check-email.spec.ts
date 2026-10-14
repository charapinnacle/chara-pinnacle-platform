import type { BrowserContext, Page } from "@playwright/test";
import { moveConfirmationSent, userByEmail } from "./support/accounts";
import { expectNoAxeViolations } from "./support/axe";
import { waitForHydration } from "./support/hydration";
import { checkEmailText, createCommittedUser, masked, requestReset, RESET_PATH, RESET_SUBJECT, RESET_WAIT, resetSent } from "./support/login";
import { messageCount, waitForMessage } from "./support/mailpit";
import { fillSignup, newEmail, PASSWORD, summary } from "./support/signup-page";
import { expect, test } from "./support/test";

const COOKIE = "chara_pending_email";

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/en/signup");
  await fillSignup(page, { kind: "worker", email, password: PASSWORD });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/en\/verify-email$/);
}

async function pendingCookie(context: BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name === COOKIE);
}

// The cooldown is counted from the time the cookie holds: moving it back stands for the minute having passed.
async function minutePasses(context: BrowserContext): Promise<void> {
  const cookie = (await pendingCookie(context))!;
  const value = JSON.parse(decodeURIComponent(cookie.value)) as { sentAt: number };
  value.sentAt -= 61_000;
  await context.addCookies([{ ...cookie, value: encodeURIComponent(JSON.stringify(value)) }]);
}

const resend = (page: Page) => page.getByRole("button", { name: /^Resend/ });

test.describe("U67: the page after sign-up and after a password reset request", () => {
  test("FR-A1: the page knows the address, shows it masked, offers a plain Resend button and keeps the address out of the URL", async ({ page, context }) => {
    const email = newEmail();
    await signUp(page, email);

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(
      page.getByText(
        `We have sent an email to ${masked(email)}. It contains the next step: a confirmation link for a new account, or a sign-in link if you already have one.`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(email);
    await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
    await expect(page.getByText("Not there? Check your spam or promotions folder.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Use a different address" })).toBeVisible();
    expect(page.url()).not.toContain(email);
    expect(page.url()).not.toContain("@");
    expect(new URL(page.url()).search).toBe("");

    const cookie = (await pendingCookie(context))!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/en", secure: false });
    expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(29 * 60);
    expect(cookie.expires - Date.now() / 1000).toBeLessThanOrEqual(30 * 60);
    expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);
    expect(JSON.parse(decodeURIComponent(cookie.value))).toMatchObject({ purpose: "signup", email });

    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoAxeViolations(page);
    }
  });

  test("FR-A1 AC10: the button shows the 60-second cooldown, stays focusable and sends nothing while it waits", async ({ page, context }) => {
    const email = newEmail();
    await signUp(page, email);
    await waitForMessage(email, { timeoutMs: 60_000 });
    const button = resend(page);
    await waitForHydration(button);
    await expect(button).toHaveText(/^Resend in (5\d|60) s$/);
    await expect(button).toHaveAttribute("aria-disabled", "true");
    expect(await button.evaluate((element) => (element as HTMLButtonElement).disabled)).toBe(false);
    await button.focus();
    await expect(button).toBeFocused();
    const first = Number(/\d+/.exec(await button.innerText())![0]);
    await expect.poll(async () => Number(/\d+/.exec(await button.innerText())![0])).toBeLessThan(first);

    await button.click({ force: true });
    await expect(page.getByRole("status")).toBeEmpty();
    expect(await messageCount(email)).toBe(1);

    await page.reload();
    await expect(resend(page)).toHaveText(/^Resend in \d+ s$/);
    await minutePasses(context);
    await page.reload();
    await expect(resend(page)).toHaveText("Resend email");
    await expect(resend(page)).not.toHaveAttribute("aria-disabled", "true");
  });

  test("FR-A1 AC10: Resend sends a second email, announces it politely and starts the cooldown again", async ({ page, context }) => {
    const email = newEmail();
    await signUp(page, email);
    await waitForMessage(email, { timeoutMs: 60_000 });
    const [user] = userByEmail(email);
    moveConfirmationSent(user.id, "2 minutes");
    await minutePasses(context);
    await page.reload();
    await waitForHydration(resend(page));

    const live = page.getByRole("status");
    await expect(live).toHaveAttribute("aria-live", "polite");
    await resend(page).click();
    await expect(live).toHaveText("We sent the email again.");
    await expect(resend(page)).toHaveText(/^Resend in \d+ s$/);
    await expect(resend(page)).toBeFocused();
    await expect.poll(() => messageCount(email), { timeout: 30_000 }).toBe(2);
    expect(JSON.parse(decodeURIComponent((await pendingCookie(context))!.value)).sentAt).toBeGreaterThan(Date.now() - 20_000);
  });

  test("FR-A1 AC5: an address that cannot be used gets the same page, the same Resend and the same answer", async ({ page, context }) => {
    const existing = await createCommittedUser("worker");
    const answers: { text: string; button: string }[] = [];
    for (const email of [existing.email, newEmail()]) {
      await signUp(page, email);
      await minutePasses(context);
      await page.reload();
      await waitForHydration(resend(page));
      await resend(page).click();
      await expect(page.getByRole("status")).toHaveText("We sent the email again.");
      answers.push({
        text: await checkEmailText(page),
        button: await resend(page).innerText().then((label) => label.replace(/\d+/, "N")),
      });
      await context.clearCookies();
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(await messageCount(existing.email)).toBe(0);
  });

  test("FR-A1 AC11: after ten resends the eleventh is refused with the wait time, and nothing more is sent", async ({ page, context }) => {
    test.setTimeout(180_000);
    const email = newEmail();
    await signUp(page, email);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await minutePasses(context);
      await page.reload();
      await waitForHydration(resend(page));
      await resend(page).click();
      await expect(page.getByRole("status")).toHaveText("We sent the email again.");
    }
    await minutePasses(context);
    await page.reload();
    await waitForHydration(resend(page));
    await resend(page).click();
    await expect(page.getByRole("status")).toHaveText(/^Too many attempts\. Try again in \d+ minutes?\.$/);
    await expect(resend(page)).toHaveText("Resend email");
    await expectNoAxeViolations(page);
  });

  test("a failed resend says so, keeps the button available and a retry works", async ({ page, context }) => {
    const email = newEmail();
    await signUp(page, email);
    await minutePasses(context);
    await page.reload();
    await waitForHydration(resend(page));
    await page.route("**/en/verify-email", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "text/x-component",
          body: `0:{"a":"$@1","f":"","b":"local"}\n1:${JSON.stringify({ cooldown: 0, message: "We could not complete this request. Try again." })}\n`,
        });
      } else await route.continue();
    });
    await resend(page).click();
    await expect(page.getByRole("status")).toHaveText("We could not complete this request. Try again.");
    await expect(resend(page)).toHaveText("Resend email");
    await expect(resend(page)).toBeEnabled();
    await page.unroute("**/en/verify-email");
    await resend(page).click();
    await expect(page.getByRole("status")).toHaveText("We sent the email again.");
  });

  test("a person without the cookie is asked for the address by the form at /verify-email, as before", async ({ page }) => {
    await page.goto("/en/verify-email");
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send a new link" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Resend/ })).toHaveCount(0);
    await page.goto("/en/verify-email?error=invalid_link");
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("Use a different address returns to the form with the address filled in for a minute, and the address is in no URL", async ({ page, context }) => {
    const email = newEmail();
    await signUp(page, email);

    await page.goto("/en/signup");
    await expect(page.getByLabel("Email address")).toHaveValue("");
    await expect(page.locator("body")).not.toContainText(email);
    expect(await page.content()).not.toContain(email);

    await page.goto("/en/verify-email");
    await waitForHydration(page.getByRole("button", { name: "Use a different address" }));
    await page.getByRole("button", { name: "Use a different address" }).click();
    await expect(page).toHaveURL(/\/en\/signup$/);
    await expect(page.getByLabel("Email address")).toHaveValue(email);
    expect(page.url()).not.toContain("@");
    const prefill = (await context.cookies()).find((cookie) => cookie.name === "chara_prefill_email")!;
    expect(prefill).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/en" });
    expect(prefill.expires - Date.now() / 1000).toBeLessThanOrEqual(60);
  });

  test("the address is not filled in again after the next link is sent", async ({ page }) => {
    await signUp(page, newEmail());
    await page.getByRole("button", { name: "Use a different address" }).click();
    const other = newEmail();
    await fillSignup(page, { kind: "worker", email: other, password: PASSWORD });
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/en\/verify-email$/);
    await page.goto("/en/signup");
    await expect(page.getByLabel("Email address")).toHaveValue("");
  });

  test("the cookie is removed when the link is used, and then /verify-email asks for an address again", async ({ page, context }) => {
    const email = newEmail();
    await signUp(page, email);
    const message = await waitForMessage(email, { timeoutMs: 60_000 });
    const link = /https?:\/\/[^\s"<>]*confirm-email\?token_hash=[\w-]+/.exec(`${message.Text}\n${message.HTML}`)![0];
    await page.goto(new URL(link).pathname + new URL(link).search);
    await page.getByRole("button", { name: "Confirm email address" }).click();
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    expect(await pendingCookie(context)).toBeUndefined();
  });

  test("a resend posted without the cookie goes back to the form and sends nothing", async ({ page, context }) => {
    const email = newEmail();
    await signUp(page, email);
    await minutePasses(context);
    await page.reload();
    await waitForHydration(resend(page));
    await context.clearCookies();
    await resend(page).click();
    await expect(page).toHaveURL(/\/en\/verify-email$/);
    await expect(page.getByLabel("Email address")).toBeVisible();
    expect(await messageCount(email)).toBeLessThanOrEqual(1);
  });
});

test.describe("U67: after a password reset request", () => {
  test("FR-A3 AC7: every address gets the page with the masked address, a Resend button and a way back with the address filled in", async ({ page, context }) => {
    const user = await createCommittedUser("worker");
    await requestReset(page, user.email);
    await expect(page).toHaveURL(RESET_PATH);
    await expect(page.getByText(resetSent(user.email), { exact: true })).toBeVisible();
    await expect(page.getByText(RESET_WAIT)).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(user.email);
    await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
    expect(page.url()).not.toContain("@");
    const cookie = (await pendingCookie(context))!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/en" });
    await expect(resend(page)).toHaveText(/^Resend in \d+ s$/);
    await expect(resend(page)).toHaveAttribute("aria-disabled", "true");
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoAxeViolations(page);
    }
    await page.getByRole("button", { name: "Use a different address" }).click();
    await expect(page).toHaveURL(/\/en\/forgot-password$/);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(user.email);
  });

  test("FR-A3 AC7, D89: an unknown address is promised nothing, is offered sign-up, and is sent no email", async ({ page }) => {
    const unknown = newEmail();
    await requestReset(page, unknown);
    await expect(page.getByText(resetSent(unknown), { exact: true })).toBeVisible();
    const hint = page.getByText(/^Not received\? Check the address or create an account\./);
    await expect(hint).toBeVisible();
    await expect(hint.getByRole("link", { name: "create an account" })).toHaveAttribute("href", "/en/signup");
    await expect(page.getByRole("main")).not.toContainText("we have sent a reset link");
    await expectNoAxeViolations(page);
    await page.waitForTimeout(1_500);
    expect(await messageCount(unknown)).toBe(0);
  });

  test("FR-A3: Resend sends a second reset email after the minute, an unknown address is told the same", async ({ page, context }) => {
    const user = await createCommittedUser("worker");
    await requestReset(page, user.email);
    await waitForMessage(user.email, { subject: RESET_SUBJECT, timeoutMs: 60_000 });
    await minutePasses(context);
    await page.reload();
    await waitForHydration(resend(page));
    // Auth holds a second email back for 60 s from the first.
    await page.waitForTimeout(100);
    await resend(page).click();
    await expect(page.getByRole("status")).toHaveText("We sent the email again.");

    const unknown = newEmail();
    await context.clearCookies();
    await requestReset(page, unknown);
    await minutePasses(context);
    await page.reload();
    await waitForHydration(resend(page));
    await resend(page).click();
    await expect(page.getByRole("status")).toHaveText("We sent the email again.");
    expect(await messageCount(unknown)).toBe(0);
  });

  test("a page without the cookie goes back to the forgot-password form", async ({ page }) => {
    await page.goto("/en/forgot-password/check-email");
    await expect(page).toHaveURL(/\/en\/forgot-password$/);
  });

  test("the address cookie is removed once the new password is saved", async ({ page, context }) => {
    const user = await createCommittedUser("worker");
    await requestReset(page, user.email);
    const message = await waitForMessage(user.email, { subject: RESET_SUBJECT, timeoutMs: 60_000 });
    const link = /https?:\/\/[^\s"<>]*reset-password\?token_hash=[\w-]+/.exec(`${message.Text}\n${message.HTML}`)![0];
    await page.goto(new URL(link).pathname + new URL(link).search);
    await page.getByLabel("New password", { exact: true }).fill("Brand-New-Pw-14");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    expect(await pendingCookie(context)).toBeUndefined();
    await expect(summary(page)).toHaveCount(0);
  });
});
