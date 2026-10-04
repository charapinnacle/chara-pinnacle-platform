import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { accountRows, currentDocuments } from "./support/accounts";
import { query, literal } from "./support/db";
import {
  BUTTON,
  createGoogleUser,
  GOOGLE_ON_URL,
  issueAuthCode,
  rpcWithToken,
  startGoogleFlow,
} from "./support/google";
import { alertText, fillLogin, overflow } from "./support/login-page";
import { authCookies, decodeSession, LOGIN_FAILED, RESET_SENT, RESET_SUBJECT, suspendProfile } from "./support/login";
import { waitForMessage } from "./support/mailpit";
import { ageBox, documentBox, EMPLOYER_LABEL, WORKER_LABEL } from "./support/signup-page";
import type { Page } from "@playwright/test";

const GOOGLE_NOTE_LOGIN = "Accounts created with Google have no password.";
const GOOGLE_NOTE_SIGNUP = "You choose worker or employer and accept the legal documents in the next step.";
const SUSPENDED = "This account is suspended. See the email we sent you for the reasons.";

function alert(page: Page, text: string) {
  return page.getByRole("alert").filter({ hasText: text });
}

async function signInThroughGoogle(page: Page, userId: string): Promise<void> {
  await page.goto("/en/login");
  const authorizeUrl = await startGoogleFlow(page);
  await page.goto(`/auth/callback?code=${issueAuthCode(userId, authorizeUrl)}`);
}

async function chooseAndAccept(page: Page, kind: "worker" | "company", skip: string[] = []): Promise<void> {
  await page.getByRole("radio", { name: kind === "worker" ? WORKER_LABEL : EMPLOYER_LABEL }).check();
  for (const { slug, title } of await currentDocuments(kind)) {
    if (skip.includes(slug)) continue;
    await (slug === "age-18-plus" ? ageBox(page) : documentBox(page, title)).check();
  }
}

test.describe("Continue with Google is off by default", () => {
  test("FR-A1, FR-A3: no Google button on sign-up, log-in or in the reset text", async ({ page }) => {
    for (const path of ["/en/signup", "/en/login", "/en/forgot-password"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
      await expect(page.getByText(/Google/)).toHaveCount(0);
    }
  });
});

test.describe("what Auth sends back to the callback", () => {
  test("FR-A3: a cancelled Google sign-in returns to the log-in page with a message and no session", async ({ page }) => {
    await page.goto("/auth/callback?error=access_denied&error_description=The+user+denied+access");
    await expect(page).toHaveURL(/\/en\/login\?error=cancelled$/);
    await expect(alert(page, "Google sign-in was cancelled")).toBeVisible();
    expect(authCookies(await page.context().cookies())).toEqual([]);
  });

  test("FR-A1: an address Google did not verify is reported as such", async ({ page }) => {
    await page.goto("/auth/callback?error=server_error&error_code=provider_email_needs_verification");
    await expect(page).toHaveURL(/\/en\/login\?error=email_unverified$/);
    await expect(alert(page, "Google has not verified this email address")).toBeVisible();
  });

  test("a code Auth does not know, or none, fails plainly and shows nothing from the URL", async ({ page }) => {
    await page.goto("/auth/callback?code=00000000-0000-4000-8000-000000000000");
    await expect(page).toHaveURL(/\/en\/login\?error=failed$/);
    await expect(alert(page, "We could not sign you in with Google. Try again.")).toBeVisible();
    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/en\/login\?error=failed$/);
    await page.goto("/en/login?error=%3Cb%3Ehacked%3C%2Fb%3E");
    await expect(page.getByText("hacked")).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  });

  test("the destination cannot be chosen through the callback", async ({ page }) => {
    await page.goto("/auth/callback?error=access_denied&next=https://evil.example");
    await expect(page).toHaveURL(/localhost:3100\/en\/login\?error=cancelled$/);
  });
});

test.describe("Continue with Google switched on", () => {
  test.use({ baseURL: GOOGLE_ON_URL });

  test("FR-A1, FR-A3: the button is shown on sign-up and log-in with a note, and the pages stay accessible", async ({ page }) => {
    for (const [path, note] of [
      ["/en/signup", GOOGLE_NOTE_SIGNUP],
      ["/en/login", GOOGLE_NOTE_LOGIN],
    ] as const) {
      for (const width of [1280, 360]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await expect(page.getByRole("button", { name: BUTTON })).toBeVisible();
        await expect(page.getByText(note)).toBeVisible();
        expect(await overflow(page)).toBe(0);
        await expectNoAxeViolations(page);
      }
    }
  });

  test("FR-A3: the reset page tells people who sign in with Google that they have no password", async ({ page }) => {
    await page.goto("/en/forgot-password");
    await expect(page.getByText(/If you sign in with Google you have no password to reset/)).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("clicking the button sends the browser to Auth's Google authorize URL with PKCE and the callback of the site", async ({ page }) => {
    await page.goto("/en/login");
    const url = await startGoogleFlow(page);
    expect(url.origin).toBe("http://127.0.0.1:54421");
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe("http://localhost:3100/auth/callback");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    expect(url.search).not.toMatch(/secret|password|token/i);
    const cookies = await page.context().cookies();
    expect(cookies.some((cookie) => cookie.name.endsWith("-auth-token-code-verifier"))).toBe(true);
    expect(authCookies(cookies).filter((cookie) => !cookie.name.includes("code-verifier"))).toEqual([]);
  });

  test("the same button on sign-up starts the same flow", async ({ page }) => {
    await page.goto("/en/signup");
    const url = await startGoogleFlow(page);
    expect(url.searchParams.get("provider")).toBe("google");
  });

  test("FR-A6, FR-A8: a Google sign-in lands on onboarding, where an employer chooses a kind, accepts the documents and cannot choose again", async ({ page }) => {
    const user = await createGoogleUser();
    expect(accountRows(user.id).account.account_kind).toBeNull();
    expect(accountRows(user.id).account.intended_account_kind).toBeNull();

    await signInThroughGoogle(page, user.id);
    await expect(page).toHaveURL(/localhost:3100\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Choose your account type" })).toBeVisible();
    await expect(page.getByText("This choice cannot be changed later.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create my account" })).toHaveCount(0);
    await expectNoAxeViolations(page);

    for (const path of ["/en/dashboard/worker", "/en/dashboard/employer", "/en/consent"]) {
      await page.goto(`http://localhost:3100${path}`);
      await expect(page).toHaveURL(/localhost:3100\/en\/onboarding$/);
    }
    expect(accountRows(user.id).consents).toEqual([]);

    await chooseAndAccept(page, "company");
    await expect(ageBox(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Create my account" }).click();
    await expect(page.getByRole("heading", { name: "Your account type is Employer" })).toBeVisible();
    await expect(page.getByText("This cannot be changed later.")).toBeVisible();

    const { account, consents, audit } = accountRows(user.id);
    expect(account.account_kind).toBe("company");
    expect(account.intended_account_kind).toBe("company");
    expect(account.pending_consents).toEqual([]);
    const documents = await currentDocuments("company");
    expect(consents.map((c) => `${c.purpose}:${c.version}:${c.action}`).sort()).toEqual(
      documents.map((d) => `${d.slug}:${d.version}:granted`).sort(),
    );
    expect(consents.map((c) => c.purpose)).not.toContain("age-18-plus");
    expect(audit.filter((a) => a.action === "account_kind_set")).toHaveLength(1);
    expect(audit.filter((a) => a.action === "consents_accepted")).toHaveLength(1);

    await page.goto("http://localhost:3100/en/dashboard/employer");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const { access_token } = decodeSession(await page.context().cookies());
    const other = await rpcWithToken(access_token, "choose_account_kind", { p_kind: "worker", p_consents: [] });
    expect(other.status).toBe(400);
    expect(other.body).toMatchObject({ message: "CHARA_FORBIDDEN", details: "account_kind is committed" });
    const same = await rpcWithToken(access_token, "choose_account_kind", {
      p_kind: "company",
      p_consents: documents.map((d) => ({ purpose: d.slug, version: d.version })),
    });
    expect(same).toEqual({ status: 200, body: "company" });
    const after = accountRows(user.id);
    expect(after.account.account_kind).toBe("company");
    expect(after.consents).toHaveLength(consents.length);
    expect(after.audit.filter((a) => a.action === "account_kind_set")).toHaveLength(1);

    await page.goto("http://localhost:3100/en/onboarding");
    await expect(page.getByRole("heading", { name: "Your account type is Employer" })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  test("FR-A9: a worker who signed in with Google must confirm the age and gets the attestation recorded", async ({ page }) => {
    const user = await createGoogleUser();
    await signInThroughGoogle(page, user.id);
    await chooseAndAccept(page, "worker", ["age-18-plus"]);
    await expect(ageBox(page)).toBeVisible();
    await page.getByRole("button", { name: "Create my account" }).click();
    await expect(alertText(page)).toContainText("Confirm that you are 18 or older to create an account");
    expect(accountRows(user.id).account.account_kind).toBeNull();
    expect(accountRows(user.id).consents).toEqual([]);

    await ageBox(page).check();
    await page.getByRole("button", { name: "Create my account" }).click();
    await expect(page.getByRole("heading", { name: "Your account type is Worker" })).toBeVisible();
    const { account, consents } = accountRows(user.id);
    expect(account.account_kind).toBe("worker");
    expect(consents.map((c) => `${c.purpose}:${c.action}`).sort()).toEqual(
      ["age-18-plus:granted", "privacy-policy:granted", "terms-of-service:granted", "worker-terms:granted"],
    );
  });

  test("FR-A8: switching the kind before submitting replaces the documents and cannot carry the age box across", async ({ page }) => {
    const user = await createGoogleUser();
    await signInThroughGoogle(page, user.id);
    await chooseAndAccept(page, "worker");
    await page.getByRole("radio", { name: EMPLOYER_LABEL }).check();
    await expect(ageBox(page)).toHaveCount(0);
    const [first] = await currentDocuments("company");
    await expect(documentBox(page, first.title)).not.toBeChecked();
    await page.getByRole("button", { name: "Create my account" }).click();
    await expect(alertText(page)).toContainText("Accept the");
    expect(accountRows(user.id).account.account_kind).toBeNull();
  });

  test("FR-A1: Google's unverified email is refused, the session is ended and nothing is created", async ({ page }) => {
    const user = await createGoogleUser({ emailVerified: false });
    await signInThroughGoogle(page, user.id);
    await expect(page).toHaveURL(/\/en\/login\?error=email_unverified$/);
    await expect(alert(page, "Google has not verified this email address")).toBeVisible();
    expect(authCookies(await page.context().cookies())).toEqual([]);
    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(/\/en\/login\?next=/);
    expect(accountRows(user.id).consents).toEqual([]);
  });

  test("FR-A3: a suspended account cannot sign in with Google", async ({ page }) => {
    const user = await createGoogleUser();
    suspendProfile(user.id);
    await signInThroughGoogle(page, user.id);
    await expect(page).toHaveURL(/\/en\/login\?error=suspended$/);
    await expect(alert(page, SUSPENDED)).toBeVisible();
    expect(authCookies(await page.context().cookies())).toEqual([]);
    expect(query(`select 1 from auth.sessions where user_id = ${literal(user.id)}`)).toEqual([]);
  });

  test("FR-A3: a person with only a Google account gets the generic answer for a password and a reset email that does not promise one", async ({ page }) => {
    const user = await createGoogleUser();
    await page.goto("/en/login");
    await fillLogin(page, user.email, "Some-Guess-0123456");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(alertText(page)).toContainText(LOGIN_FAILED);
    expect(authCookies(await page.context().cookies())).toEqual([]);
    await expect(page.getByText(GOOGLE_NOTE_LOGIN)).toBeVisible();

    await page.goto("/en/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(RESET_SENT)).toBeVisible();
    const message = await waitForMessage(user.email, { subject: RESET_SUBJECT });
    expect(message.Text).toContain("Continue with Google");
    expect(message.Text).not.toMatch(/password stays as it is/i);
  });
});
