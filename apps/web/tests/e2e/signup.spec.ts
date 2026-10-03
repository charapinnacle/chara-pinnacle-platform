import { expect, test, type BrowserContext } from "@playwright/test";
import { env } from "@/lib/env";
import {
  accountRows,
  currentDocuments,
  pendingConsents,
  userByEmail,
} from "./support/accounts";
import { extractLinks, messageCount, waitForMessage } from "./support/mailpit";
import {
  ageBox,
  documentBox,
  EMPLOYER_LABEL,
  fillSignup,
  newEmail,
  PASSWORD,
  summary,
  WORKER_LABEL,
} from "./support/signup-page";
import { captureActionRequests } from "./support/server-action";
import { createTestUser, deleteTestUser } from "./support/test-user";

const authUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
const apikey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Sign-up leaves PKCE code-verifier cookies; a session is a cookie named like sb-<ref>-auth-token(.n).
async function sessionCookies(context: BrowserContext) {
  return (await context.cookies()).filter((cookie) =>
    /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name),
  );
}

test.describe("sign-up form", () => {
  test("FR-A1 AC1, FR-A9 AC6: a worker registers, sees Check your email and nothing is committed before confirmation", async ({
    page,
    context,
  }) => {
    const email = newEmail();
    const calls = captureActionRequests(page);
    await page.goto("/en/signup");
    await fillSignup(page, { kind: "worker", email, password: PASSWORD });
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/en\/verify-email$/);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText("Could not create the account")).toHaveCount(0);
    expect(await sessionCookies(context)).toEqual([]);

    const [user] = userByEmail(email);
    expect(user.email_confirmed_at).toBeNull();
    const { account, consents } = accountRows(user.id);
    expect(account).toMatchObject({
      intended_account_kind: "worker",
      account_kind: null,
      status: "active",
      preferred_lang: "en",
    });
    expect(account.pending_consents.map((entry) => entry.purpose).sort()).toEqual([
      "age-18-plus",
      "privacy-policy",
      "terms-of-service",
      "worker-terms",
    ]);
    expect(consents).toEqual([]);
    expect(Object.keys(account.raw_user_meta_data).sort()).toEqual([
      "email",
      "email_verified",
      "intended_account_kind",
      "pending_consents",
      "phone_verified",
      "sub",
    ]);

    const message = await waitForMessage(email, { timeoutMs: 60_000 });
    expect(await messageCount(email)).toBe(1);
    expect(extractLinks(message).some((link) => link.includes("/en/confirm-email?token_hash="))).toBe(true);
    expect(`${message.Text}${message.HTML}`).not.toContain(PASSWORD);

    expect(calls).toHaveLength(1);
    const [payload] = JSON.parse(calls[0].body) as Record<string, unknown>[];
    expect(Object.keys(payload).sort()).toEqual(["consents", "email", "kind", "password"]);
    expect(payload.consents).toEqual(await pendingConsents("worker"));
    expect(JSON.stringify(payload)).not.toMatch(/\d{4}-\d{2}-\d{2}|birth|dob/i);
  });

  test("FR-A1 AC5: a repeat sign-up of a confirmed address looks like a new one and changes nothing", async ({
    page,
    context,
    request,
  }) => {
    const existing = await createTestUser("worker");
    try {
      const calls = captureActionRequests(page);
      await page.goto("/en/signup");
      await fillSignup(page, {
        kind: "company",
        email: existing.email.toUpperCase(),
        password: "Another-Passw0rd",
      });
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL(/\/en\/verify-email$/);
      const duplicateStatus = calls[0].status();

      await page.goto("/en/signup");
      await fillSignup(page, { kind: "company", email: newEmail(), password: "Another-Passw0rd" });
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL(/\/en\/verify-email$/);
      expect(calls[1].status()).toBe(duplicateStatus);

      expect(userByEmail(existing.email)).toHaveLength(1);
      expect(accountRows(existing.id).account).toMatchObject({
        intended_account_kind: "worker",
        account_kind: null,
      });
      expect(await sessionCookies(context)).toEqual([]);
      await expect(waitForMessage(existing.email, { timeoutMs: 1_500 })).rejects.toThrow("No message for");

      const signIn = (password: string) =>
        request.post(`${authUrl}/token?grant_type=password`, {
          headers: { apikey },
          data: { email: existing.email, password },
        });
      expect((await signIn(existing.password)).status()).toBe(200);
      expect((await signIn("Another-Passw0rd")).status()).toBe(400);
    } finally {
      await deleteTestUser(existing.id);
    }
  });

  test("FR-A8 AC1, FR-A9 AC1, FR-A6 AC1: the kind comes first, is final, and decides the documents and the age box", async ({
    page,
  }) => {
    const workerDocuments = await currentDocuments("worker");
    const employerDocuments = await currentDocuments("company");
    await page.goto("/en/signup");

    const group = page.getByRole("radiogroup", { name: "I want to register as" });
    await expect(group.getByRole("radio")).toHaveCount(2);
    await expect(group.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(
      page.getByText(
        "This choice cannot be changed later. To use CHARA as both worker and employer, register a second account with a different email address.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);

    await page.getByRole("radio", { name: WORKER_LABEL }).check();
    await expect(page.getByRole("checkbox")).toHaveCount(4);
    for (const { slug, title, version } of workerDocuments) {
      if (slug === "age-18-plus") {
        await expect(ageBox(page)).not.toBeChecked();
        continue;
      }
      const box = documentBox(page, title);
      await expect(box).not.toBeChecked();
      const label = page.locator("label", { has: page.locator(`a[href="/en/legal/${slug}"]`) });
      await expect(label).toContainText(`version ${version}, published`);
      await expect(label.getByRole("link")).toHaveAttribute("href", `/en/legal/${slug}`);
    }
    await ageBox(page).check();
    await documentBox(page, workerDocuments[0].title).check();

    await page.getByRole("radio", { name: EMPLOYER_LABEL }).check();
    await expect(page.getByRole("checkbox")).toHaveCount(3);
    await expect(ageBox(page)).toHaveCount(0);
    await expect(page.getByLabel(/birth|age number/i)).toHaveCount(0);
    for (const { title } of employerDocuments) {
      await expect(documentBox(page, title)).not.toBeChecked();
    }
    await expect(page.getByText(/Worker Terms/)).toHaveCount(0);

    await documentBox(page, employerDocuments[0].title).check();
    await page.getByRole("radio", { name: WORKER_LABEL }).check();
    await expect(page.getByRole("checkbox")).toHaveCount(4);
    for (const box of await page.getByRole("checkbox").all()) {
      await expect(box).not.toBeChecked();
    }

    await page.getByRole("button", { name: "Create account" }).click();
    await expect(summary(page)).toBeFocused();
  });

  test("FR-A6 AC1, FR-A8 AC1: an employer sign-up carries only the employer documents and no age attestation", async ({
    page,
  }) => {
    const email = newEmail();
    const calls = captureActionRequests(page);
    await page.goto("/en/signup");
    await fillSignup(page, { kind: "worker", email: "worker-first@example.test", password: PASSWORD });
    await page.getByRole("radio", { name: EMPLOYER_LABEL }).check();
    await fillSignup(page, { kind: "company", email, password: PASSWORD });
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/en\/verify-email$/);

    expect(calls).toHaveLength(1);
    const [payload] = JSON.parse(calls[0].body) as { kind: string; consents: { purpose: string }[] }[];
    expect(payload.kind).toBe("company");
    expect(payload.consents).toEqual(await pendingConsents("company"));
    expect(calls[0].body).not.toMatch(/worker-terms|age-18-plus/);

    const [user] = userByEmail(email);
    const { account, consents } = accountRows(user.id);
    expect(account.intended_account_kind).toBe("company");
    expect(account.pending_consents.map((entry) => entry.purpose).sort()).toEqual([
      "employer-terms",
      "privacy-policy",
      "terms-of-service",
    ]);
    expect(consents).toEqual([]);
  });

  test("FR-A6 AC1: submitting without a kind is refused", async ({ page }) => {
    await page.goto("/en/signup");
    await page.getByLabel("Email address").fill(newEmail());
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(summary(page)).toContainText("Choose worker or employer");
    await expect(page).toHaveURL(/\/en\/signup$/);
  });

  test("FR-A8 AC2, FR-A9 AC2: a missing consent or attestation stops the sign-up in the form and in a direct call", async ({
    page,
    request,
  }) => {
    const privacy = (await currentDocuments("worker")).find((d) => d.slug === "privacy-policy")!;
    const calls = captureActionRequests(page);

    for (const [skipped, message] of [
      ["privacy-policy", new RegExp(`Accept the ${privacy.title} to continue`)],
      ["age-18-plus", /Confirm that you are 18 or older to create an account/],
    ] as const) {
      const email = newEmail();
      await page.goto("/en/signup");
      await fillSignup(page, { kind: "worker", email, password: PASSWORD, skip: [skipped] });
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(summary(page)).toBeFocused();
      await expect(summary(page)).toContainText(message);
      const box = skipped === "age-18-plus" ? ageBox(page) : documentBox(page, privacy.title);
      const describedBy = await box.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      await expect(page.locator(`[id="${describedBy}"]`)).toContainText(message);
      await expect(page).toHaveURL(/\/en\/signup$/);
      expect(userByEmail(email)).toEqual([]);
      expect(calls).toHaveLength(0);
    }

    const email = newEmail();
    await page.goto("/en/signup");
    await fillSignup(page, { kind: "worker", email, password: PASSWORD });
    await page.route("**/en/signup", async (route) => {
      const original = route.request();
      if (original.method() !== "POST") return route.continue();
      const entries = JSON.parse(original.postData() ?? "[]") as { consents: { purpose: string }[] }[];
      entries[0].consents = entries[0].consents.filter((c) => c.purpose !== "age-18-plus");
      const headers = original.headers();
      return route.fulfill({
        response: await request.post("/en/signup", {
          headers: {
            "next-action": headers["next-action"],
            "content-type": headers["content-type"],
            accept: "text/x-component",
            origin: "http://localhost:3100",
          },
          data: JSON.stringify(entries),
        }),
      });
    });
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(summary(page)).toContainText("Confirm that you are 18 or older to create an account");
    expect(userByEmail(email)).toEqual([]);
  });
});
