import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import type { BrowserContext } from "@playwright/test";
import {
  accountRows,
  confirmFromLink,
  createUnconfirmedUser,
  moveConfirmationSent,
  pendingConsents,
} from "./support/accounts";
import { messageCount, waitForMessage } from "./support/mailpit";
import { signInBrowser } from "./support/session";
import { createTestUser, deleteTestUser } from "./support/test-user";

const INVALID_LINK = "This link is invalid or has expired.";
const WORKER_SLUGS = [
  "terms-of-service",
  "privacy-policy",
  "worker-terms",
  "age-18-plus",
];

async function sessionCookies(context: BrowserContext) {
  return (await context.cookies()).filter((cookie) =>
    /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name),
  );
}

test.describe("email confirmation", () => {
  test("FR-A1 AC7, FR-A6 AC3: the link activates the account and onboarding commits the kind and the consents once", async ({
    page,
  }) => {
    const user = await createUnconfirmedUser("worker");
    moveConfirmationSent(user.id, "1 hour");
    const versions = await pendingConsents("worker");

    await confirmFromLink(page, user.confirmPath);
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(
      page.getByRole("heading", { name: "Your account type is Worker" }),
    ).toBeVisible();
    await expect(page.getByText("This cannot be changed later.")).toBeVisible();
    await expectNoAxeViolations(page);

    await expect
      .poll(() => accountRows(user.id).account.account_kind)
      .toBe("worker");
    const { account, consents, audit } = accountRows(user.id);
    expect(account.email_confirmed_at).not.toBeNull();
    expect(account.pending_consents).toEqual([]);
    expect(consents.map((c) => `${c.purpose}:${c.version}:${c.action}`).sort()).toEqual(
      versions.map((v) => `${v.purpose}:${v.version}:granted`).sort(),
    );
    expect(consents.map((c) => c.purpose).sort()).toEqual([...WORKER_SLUGS].sort());
    expect(audit.filter((a) => a.action === "account_kind_set")).toHaveLength(1);
    expect(audit.filter((a) => a.action === "consents_accepted")).toHaveLength(1);
    expect(await sessionCookies(page.context())).not.toEqual([]);
  });

  test("FR-A6 AC8: the onboarding page states the employer kind, fits 360 px and takes focus in page order", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const user = await createUnconfirmedUser("company");
    await confirmFromLink(page, user.confirmPath);
    await expect(
      page.getByRole("heading", { name: "Your account type is Employer" }),
    ).toBeVisible();
    await expect(page.getByText("This cannot be changed later.")).toBeVisible();
    await page.reload();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    expect(accountRows(user.id).consents.map((c) => c.purpose).sort()).toEqual([
      "employer-terms",
      "privacy-policy",
      "terms-of-service",
    ]);
  });

  test("FR-A1 AC8: the link works up to 24 hours, then Auth reports one message for an expired and a used link", async ({
    page,
    browser,
  }) => {
    const inTime = await createUnconfirmedUser();
    moveConfirmationSent(inTime.id, "23 hours 59 minutes");
    await confirmFromLink(page, inTime.confirmPath);
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: /Your account type is/ })).toBeVisible();

    const expired = await createUnconfirmedUser();
    moveConfirmationSent(expired.id, "24 hours 1 minute");
    const expiredContext = await browser.newContext();
    const expiredPage = await expiredContext.newPage();
    await confirmFromLink(expiredPage, expired.confirmPath);
    await expect(expiredPage.getByRole("heading", { name: INVALID_LINK })).toBeVisible();
    await expect(expiredPage.getByRole("button", { name: "Send a new link" })).toBeVisible();
    await expectNoAxeViolations(expiredPage);
    expect(await sessionCookies(expiredContext)).toEqual([]);
    const afterExpired = accountRows(expired.id);
    expect(afterExpired.account.email_confirmed_at).toBeNull();
    expect(afterExpired.account.account_kind).toBeNull();
    expect(afterExpired.consents).toEqual([]);
    expect(afterExpired.audit).toEqual([]);
    await expiredContext.close();

    await expect.poll(() => accountRows(inTime.id).account.account_kind).toBe("worker");
    const before = accountRows(inTime.id);
    for (const context of [page.context(), await browser.newContext()]) {
      const reopened = await context.newPage();
      await confirmFromLink(reopened, inTime.confirmPath);
      await expect(reopened.getByRole("heading", { name: INVALID_LINK })).toBeVisible();
    }
    const after = accountRows(inTime.id);
    expect(after.consents).toEqual(before.consents);
    expect(after.audit).toEqual(before.audit);
    expect(after.account.email_confirmed_at).toBe(before.account.email_confirmed_at);
  });

  test("FR-A1 AC7: opening the link without a click, as a mail scanner does, leaves it usable", async ({
    page,
    request,
  }) => {
    const user = await createUnconfirmedUser();
    await page.goto(user.confirmPath);
    await expect(page.getByRole("button", { name: "Confirm email address" })).toBeVisible();
    await expectNoAxeViolations(page);
    for (let fetch = 0; fetch < 2; fetch += 1) {
      const response = await request.get(user.confirmPath);
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain("Confirm email address");
      expect(response.headers()["set-cookie"]).toBeUndefined();
    }
    expect(accountRows(user.id).account.email_confirmed_at).toBeNull();

    await confirmFromLink(page, user.confirmPath);
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect.poll(() => accountRows(user.id).account.account_kind).toBe("worker");
    expect(accountRows(user.id).account.email_confirmed_at).not.toBeNull();
  });

  test("FR-A1 AC7: a link without a token, or with a malformed one, lands on the invalid-link page", async ({
    page,
  }) => {
    await page.goto("/en/confirm-email");
    await expect(page.getByRole("heading", { name: INVALID_LINK })).toBeVisible();
    await confirmFromLink(page, "/en/confirm-email?token_hash=%3Cscript%3E");
    await expect(page.getByRole("heading", { name: INVALID_LINK })).toBeVisible();
  });

  test("FR-A1 AC9: a next parameter never leaves the site", async ({ browser }) => {
    for (const next of ["https://evil.example", "//evil.example"]) {
      const user = await createUnconfirmedUser();
      const context = await browser.newContext();
      const page = await context.newPage();
      const hosts = new Set<string>();
      page.on("request", (request) => hosts.add(new URL(request.url()).host));
      await confirmFromLink(
        page,
        `${user.confirmPath}&next=${encodeURIComponent(next)}`,
      );
      await expect(page).toHaveURL("http://localhost:3100/en/onboarding");
      expect(hosts.has("evil.example")).toBe(false);
      await context.close();
    }
  });

  test("FR-A1 AC10: resend answers alike, sends only to the waiting address, replaces the old link and is throttled", async ({
    page,
  }) => {
    const waiting = await createUnconfirmedUser();
    moveConfirmationSent(waiting.id, "2 minutes");
    const confirmed = await createTestUser("worker");
    const unknown = `nobody-${waiting.id}@example.test`;
    const answer =
      "If an account with this email is waiting for confirmation, a new link has been sent.";

    async function resend(email: string) {
      await page.goto("/en/verify-email?error=invalid_link");
      await page.getByLabel("Email address").fill(email);
      await page.getByRole("button", { name: "Send a new link" }).click();
      await expect(page.getByRole("status")).toHaveText(answer);
    }

    try {
      await resend(waiting.email);
      await resend(confirmed.email);
      await resend(unknown);

      const mail = await waitForMessage(waiting.email);
      expect(mail.Subject).toBe("Confirm your CHARA account");
      await expect(waitForMessage(confirmed.email, { timeoutMs: 1_500 })).rejects.toThrow("No message for");
      await expect(waitForMessage(unknown, { timeoutMs: 1_500 })).rejects.toThrow("No message for");

      await confirmFromLink(page, waiting.confirmPath);
      await expect(page.getByRole("heading", { name: INVALID_LINK })).toBeVisible();

      const sent = await messageCount(waiting.email);
      await resend(waiting.email);
      await page.waitForTimeout(1_000);
      expect(await messageCount(waiting.email)).toBe(sent);
    } finally {
      await deleteTestUser(confirmed.id);
    }
  });
});

test.describe("onboarding commit", () => {
  test("FR-A6 AC4: two tabs commit at the same moment and leave one audit row and one set of consents", async ({
    context,
  }) => {
    const user = await createTestUser("worker", await pendingConsents("worker"));
    try {
      await signInBrowser(context, user);
      const [first, second] = await Promise.all([context.newPage(), context.newPage()]);
      await Promise.all([first.goto("/en/onboarding"), second.goto("/en/onboarding")]);
      for (const page of [first, second]) {
        await expect(
          page.getByRole("heading", { name: "Your account type is Worker" }),
        ).toBeVisible();
        await expect(page.getByText("Could not set up your account")).toHaveCount(0);
      }
      const { account, consents, audit } = accountRows(user.id);
      expect(account.account_kind).toBe("worker");
      expect(consents).toHaveLength(4);
      expect(audit.filter((a) => a.action === "account_kind_set")).toHaveLength(1);
      expect(audit.filter((a) => a.action === "consents_accepted")).toHaveLength(1);
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test("FR-A6 AC8: a loading state shows while the kind is committed, a failure shows a toast and the page can be retried", async ({
    context,
    page,
  }) => {
    const user = await createTestUser("company", await pendingConsents("company"));
    try {
      await signInBrowser(context, user);
      let failures = 1;
      await page.route("**/en/onboarding", async (route) => {
        if (route.request().method() !== "POST" || failures === 0) {
          return route.continue();
        }
        failures -= 1;
        await new Promise((resolve) => setTimeout(resolve, 800));
        return route.abort();
      });
      await page.goto("/en/onboarding");
      await expect(page.getByRole("status")).toContainText("Loading");
      await expect(page.getByText("Could not set up your account", { exact: true })).toBeVisible();
      expect(accountRows(user.id).account.account_kind).toBeNull();

      await page.getByRole("button", { name: "Try again" }).click();
      await expect(
        page.getByRole("heading", { name: "Your account type is Employer" }),
      ).toBeVisible();
      expect(accountRows(user.id).account.account_kind).toBe("company");
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test("an anonymous visitor to onboarding is sent to log in", async ({ page }) => {
    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(/\/en\/login\?next=%2Fen%2Fonboarding$/);
  });
});
