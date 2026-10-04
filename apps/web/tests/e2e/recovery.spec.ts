import { expect, test, type Browser, type Page } from "@playwright/test";
import { createUnconfirmedUser } from "./support/accounts";
import {
  ageRecoveryLink,
  auditRows,
  CHANGED_SUBJECT,
  createCommittedUser,
  decodeSession,
  emailedResetPath,
  enrollTotp,
  expireAccessToken,
  expireRecoveryTokens,
  generateRecoveryPath,
  LINK_EXPIRED,
  passwordLoginStatus,
  refreshStatus,
  RESET_SENT,
  sessionClaims,
  sessionRows,
  verifyRecoveryStatus,
} from "./support/login";
import { messageCount, waitForMessage } from "./support/mailpit";
import { signInBrowser } from "./support/session";
import { newEmail } from "./support/signup-page";
import { type TestUser } from "./support/test-user";
import { totpCode } from "./support/totp";

const NEW_PASSWORD = "Brand-New-Pw-14";
const SHORT_PASSWORD = "Eleven-char";

function newPasswordField(page: Page) {
  return page.getByLabel("New password", { exact: true });
}

function submit(page: Page) {
  return page.getByRole("button", { name: "Change password" }).click();
}

function summary(page: Page) {
  return page.getByRole("alert").filter({ hasText: "There is a problem" });
}

async function openResetInNewContext(browser: Browser, user: TestUser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(await generateRecoveryPath(user.email));
  return { context, page };
}

test.describe("password recovery", () => {
  test("FR-A3 AC7: every address gets the same answer and only a real account gets one email with a single-use link", async ({
    page,
  }) => {
    const confirmed = await createCommittedUser("worker");
    const unconfirmed = await createUnconfirmedUser("worker");
    const unknown = newEmail();

    const answers = [];
    for (const email of [confirmed.email, unconfirmed.email, unknown, confirmed.email]) {
      await page.goto("/en/forgot-password");
      await page.getByLabel("Email", { exact: true }).fill(email);
      const response = page.waitForResponse((r) => r.request().method() === "POST");
      await page.getByRole("button", { name: "Send reset link" }).click();
      await expect(page.getByRole("status")).toHaveText(RESET_SENT);
      answers.push({ status: (await response).status(), text: await page.getByRole("status").innerText() });
    }
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);

    const message = await waitForMessage(confirmed.email, { subject: "Reset your CHARA password" });
    const body = `${message.HTML}\n${message.Text}`;
    expect(body).toMatch(/\/en\/reset-password\?token_hash=[A-Za-z0-9_-]+/);
    expect(body).not.toContain(confirmed.password);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    // The repeat request above came at once, inside Auth's 60-second interval, so it sent nothing more.
    expect(await messageCount(confirmed.email)).toBe(1);
    expect(await messageCount(unknown)).toBe(0);
    // Departure D24: Auth does email an unconfirmed address (AC7 expects none); this pins that behaviour.
    await waitForMessage(unconfirmed.email, { subject: "Reset your CHARA password" });
    expect(await messageCount(unconfirmed.email)).toBe(1);
  });

  test("FR-A3 AC8: a link opens the form for under an hour, then says it expired; opening it spends nothing", async ({
    page,
  }) => {
    const young = await createCommittedUser("worker");
    const path = await generateRecoveryPath(young.email);
    ageRecoveryLink(young.id, "59 minutes");
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await page.reload();
    await expect(newPasswordField(page)).toBeVisible();

    const old = await createCommittedUser("worker");
    const oldPath = await generateRecoveryPath(old.email);
    ageRecoveryLink(old.id, "61 minutes");
    await page.goto(oldPath);
    await expect(page.getByRole("heading", { name: LINK_EXPIRED })).toBeVisible();
    await expect(newPasswordField(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Request a new reset link" }).click();
    await expect(page).toHaveURL(/\/en\/forgot-password$/);
  });

  test("FR-A3 AC8: Auth itself refuses a link older than an hour, so it cannot be posted to Auth directly", async () => {
    const user = await createCommittedUser("worker");
    const hash = new URL(await generateRecoveryPath(user.email), "http://web.test").searchParams.get("token_hash");
    if (!hash) throw new Error("The recovery link has no token");
    ageRecoveryLink(user.id, "61 minutes");
    expireRecoveryTokens();
    expect(await verifyRecoveryStatus(hash)).toBeGreaterThanOrEqual(400);
    expect(sessionRows(user.id)).toEqual([]);

    const young = await createCommittedUser("worker");
    const youngHash = new URL(await generateRecoveryPath(young.email), "http://web.test").searchParams.get("token_hash");
    ageRecoveryLink(young.id, "59 minutes");
    expireRecoveryTokens();
    expect(await verifyRecoveryStatus(youngHash ?? "")).toBe(200);
  });

  test("FR-A3 AC8: a used link and a superseded link say they expired", async ({ browser, page }) => {
    const user = await createCommittedUser("worker");
    const { context, page: used } = await openResetInNewContext(browser, user);
    const usedPath = new URL(used.url()).pathname + new URL(used.url()).search;
    await newPasswordField(used).fill(NEW_PASSWORD);
    await submit(used);
    await expect(used).toHaveURL(/\/en\/dashboard\/worker$/);
    await context.close();

    await page.goto(usedPath);
    await expect(page.getByRole("heading", { name: LINK_EXPIRED })).toBeVisible();
    await expect(newPasswordField(page)).toHaveCount(0);

    const other = await createCommittedUser("worker");
    const first = await generateRecoveryPath(other.email);
    const second = await generateRecoveryPath(other.email);
    await page.goto(first);
    await expect(page.getByRole("heading", { name: LINK_EXPIRED })).toBeVisible();
    await page.goto(second);
    await expect(newPasswordField(page)).toBeVisible();

    await page.goto("/en/reset-password");
    await expect(page.getByRole("heading", { name: LINK_EXPIRED })).toBeVisible();
    await page.goto("/en/reset-password?token_hash=%3Cscript%3E");
    await expect(page.getByRole("heading", { name: LINK_EXPIRED })).toBeVisible();
  });

  test("FR-A3 AC8: a link that expires while the form is open is refused on submit", async ({
    browser,
  }) => {
    const user = await createCommittedUser("worker");
    const { context, page } = await openResetInNewContext(browser, user);
    ageRecoveryLink(user.id, "61 minutes");
    await newPasswordField(page).fill(NEW_PASSWORD);
    await submit(page);
    await expect(page.getByRole("heading", { name: LINK_EXPIRED })).toBeVisible();
    expect(await passwordLoginStatus(user, NEW_PASSWORD)).toBe(400);
    expect(await passwordLoginStatus(user, user.password)).toBe(200);
    await context.close();
  });

  test("FR-A3 AC9, AC10: the policy is enforced, other sessions end, the old password stops working and the change is mailed and audited", async ({
    browser,
  }) => {
    const user = await createCommittedUser("worker");
    const a = await browser.newContext();
    await signInBrowser(a, user);
    const aRefresh = decodeSession(await a.cookies()).refresh_token;
    expect(sessionRows(user.id)).toHaveLength(1);

    const { context: b, page } = await openResetInNewContext(browser, user);
    await newPasswordField(page).fill(SHORT_PASSWORD);
    await submit(page);
    await expect(summary(page)).toBeFocused();
    await expect(summary(page)).toContainText("Password must be at least 12 characters.");
    expect(await passwordLoginStatus(user, user.password)).toBe(200);
    expect(await passwordLoginStatus(user, SHORT_PASSWORD)).toBe(400);
    expect(auditRows(user.id, "password_changed")).toEqual([]);

    await newPasswordField(page).fill(NEW_PASSWORD);
    await submit(page);
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    expect((await sessionClaims(b)).aal).toBe("aal1");

    expect(await refreshStatus(aRefresh)).toBe(400);
    await expireAccessToken(a);
    const pageA = await a.newPage();
    await pageA.goto("/en/dashboard/worker");
    await expect(pageA).toHaveURL(/\/en\/login/);
    expect(sessionRows(user.id)).toHaveLength(1);
    expect(await passwordLoginStatus(user, user.password)).toBe(400);
    expect(await passwordLoginStatus(user, NEW_PASSWORD)).toBe(200);

    const notice = await waitForMessage(user.email, { subject: CHANGED_SUBJECT });
    const body = `${notice.HTML}\n${notice.Text}`;
    expect(body).not.toContain(NEW_PASSWORD);
    expect(body).not.toContain(user.password);
    expect(body).not.toMatch(/token_hash|reset-password\?/);

    const rows = auditRows(user.id, "password_changed");
    expect(rows).toEqual([
      { actor_id: user.id, entity_type: "user", entity_id: user.id, metadata: {} },
    ]);
    await a.close();
    await b.close();
  });

  test("FR-A3 AC9: a user with two-step verification gives the authenticator code before the password is saved", async ({
    browser,
  }) => {
    const user = await createCommittedUser("worker");
    const secret = await enrollTotp(user);
    const a = await browser.newContext();
    await signInBrowser(a, user);
    const aRefresh = decodeSession(await a.cookies()).refresh_token;

    const { context: b, page } = await openResetInNewContext(browser, user);
    await newPasswordField(page).fill(NEW_PASSWORD);
    await submit(page);
    const code = page.getByLabel("Authenticator code");
    await expect(code).toBeFocused();
    expect(await passwordLoginStatus(user, NEW_PASSWORD)).toBe(400);

    await code.fill("000000");
    await submit(page);
    await expect(summary(page)).toContainText("The code is incorrect or has expired.");
    expect(await passwordLoginStatus(user, NEW_PASSWORD)).toBe(400);

    await code.fill(totpCode(secret, Date.now() + 30_000));
    await submit(page);
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    expect((await sessionClaims(b)).aal).toBe("aal2");

    expect(await refreshStatus(aRefresh)).toBe(400);
    expect(await passwordLoginStatus(user, user.password)).toBe(400);
    expect(await passwordLoginStatus(user, NEW_PASSWORD)).toBe(200);
    expect(auditRows(user.id, "password_changed")).toHaveLength(1);
    await a.close();
    await b.close();
  });

  test("FR-A3: a refused password does not use the link up, so a second try succeeds", async ({
    browser,
  }) => {
    const user = await createCommittedUser("worker");
    const { context, page } = await openResetInNewContext(browser, user);
    await newPasswordField(page).fill(user.password);
    await submit(page);
    await expect(summary(page)).toContainText("Choose a password different from your current one.");
    expect(auditRows(user.id, "password_changed")).toEqual([]);

    await newPasswordField(page).fill(NEW_PASSWORD);
    await submit(page);
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    expect(await passwordLoginStatus(user, NEW_PASSWORD)).toBe(200);
    await context.close();
  });

  test("FR-A3: the reset and forgot-password pages fit 360 px", async ({ browser }) => {
    const user = await createCommittedUser("worker");
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    for (const path of ["/en/forgot-password", await generateRecoveryPath(user.email)]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await context.close();
  });

  test("FR-A3 AC7: an emailed link works end to end from the form to a new login", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    await page.goto("/en/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toHaveText(RESET_SENT);

    await page.goto(await emailedResetPath(user.email));
    await newPasswordField(page).fill(NEW_PASSWORD);
    await submit(page);
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/en\/login$/);

    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
  });
});
