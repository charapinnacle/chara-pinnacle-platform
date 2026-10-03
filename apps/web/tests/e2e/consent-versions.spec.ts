import { expect, test } from "@playwright/test";
import {
  accountRows,
  callAs,
  createUnconfirmedUser,
  pendingConsents,
  publishNewVersion,
} from "./support/accounts";
import { signInBrowser } from "./support/session";
import { createTestUser, deleteTestUser } from "./support/test-user";

// These tests publish new versions of legal documents. Versions cannot be removed
// (consents reference them), so they run after every other test in their own
// project and a database reset returns the stack to version 0.
test.describe.configure({ mode: "serial" });

test("FR-A8 AC5: a version superseded before confirmation is accepted first and the kind waits for it", async ({
  page,
}) => {
  const user = await createUnconfirmedUser("worker");
  const signedUpWith = (await pendingConsents("worker")).find(
    (entry) => entry.purpose === "privacy-policy",
  )!;
  const newVersion = publishNewVersion("privacy-policy", "Adds the new retention periods.");
  expect(newVersion).toBe(signedUpWith.version + 1);

  await page.goto(user.confirmPath);
  await expect(page).toHaveURL(/\/en\/onboarding$/);
  await expect(page.getByRole("heading", { name: /^Set up your Worker account/ })).toBeVisible();
  await expect(page.getByText(`Version ${newVersion}, published`)).toBeVisible();
  await expect(page.getByText("Adds the new retention periods.")).toBeVisible();
  const box = page.getByRole("checkbox", { name: /I accept the .*Privacy Policy/ });
  await expect(box).not.toBeChecked();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  expect(accountRows(user.id).account.account_kind).toBeNull();

  await page.getByRole("button", { name: "Accept and continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText(
    "Accept the",
  );
  expect(accountRows(user.id).account.account_kind).toBeNull();

  await box.check();
  await page.getByRole("button", { name: "Accept and continue" }).click();
  await expect(page.getByRole("heading", { name: "Your account type is Worker" })).toBeVisible();

  const { account, consents } = accountRows(user.id);
  expect(account.account_kind).toBe("worker");
  const privacy = consents.filter((c) => c.purpose === "privacy-policy");
  expect(privacy).toEqual([{ purpose: "privacy-policy", version: newVersion, action: "granted" }]);
  expect(consents).toHaveLength(4);
});

test("FR-A8 AC9: a changed document gates the next sign-in, not the open session, and legal pages stay open", async ({
  browser,
  page,
}) => {
  const user = await createTestUser("company", await pendingConsents("company"));
  try {
    await signInBrowser(page.context(), user);
    await page.goto("/en/onboarding");
    await expect(page.getByRole("heading", { name: "Your account type is Employer" })).toBeVisible();

    const version = publishNewVersion("employer-terms", "Adds the data processing annex.");

    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Your account type is Employer" })).toBeVisible();

    const signedOut = await browser.newContext();
    await signInBrowser(signedOut, user);
    const next = await signedOut.newPage();
    await next.goto("/en/onboarding");
    await expect(next).toHaveURL(/\/en\/consent\?next=%2Fen%2Fonboarding$/);
    await expect(next.getByRole("heading", { name: /Employer Terms/ })).toBeVisible();
    await expect(next.getByText(`Version ${version}, published`)).toBeVisible();
    await expect(next.getByText("Adds the data processing annex.")).toBeVisible();
    await expect(next.getByRole("link", { name: /Read the full text/ })).toHaveAttribute(
      "href",
      "/en/legal/employer-terms",
    );
    await expect(next.getByRole("checkbox")).toHaveCount(1);
    await expect(next.getByText(/Terms of Service/)).toHaveCount(0);

    const legal = await next.request.get("/en/legal/employer-terms", { maxRedirects: 0 });
    expect(legal.status()).toBe(200);

    await next.getByRole("button", { name: "Accept and continue" }).click();
    await expect(next.getByRole("alert").filter({ hasText: "There is a problem" })).toBeVisible();
    expect(accountRows(user.id).consents.at(-1)?.version).toBeLessThan(version);

    const another = await (await browser.newContext()).newPage();
    await signInBrowser(another.context(), user);
    await another.goto("/en/onboarding");
    await expect(another).toHaveURL(/\/en\/consent/);

    await next.getByRole("checkbox").check();
    await next.getByRole("button", { name: "Accept and continue" }).click();
    await expect(next).toHaveURL(/\/en\/onboarding$/);
    await expect(next.getByRole("heading", { name: "Your account type is Employer" })).toBeVisible();
    expect(accountRows(user.id).consents.at(-1)).toEqual({
      purpose: "employer-terms",
      version,
      action: "granted",
    });

    await another.goto("/en/onboarding");
    await expect(another).toHaveURL(/\/en\/onboarding$/);
  } finally {
    await deleteTestUser(user.id);
  }
});

test("FR-A8 AC10 (web part): a withdrawal holds the next sign-in on the consent page until the document is accepted again", async ({
  browser,
}) => {
  const user = await createTestUser("worker", await pendingConsents("worker"));
  try {
    const first = await browser.newContext();
    await signInBrowser(first, user);
    const page = await first.newPage();
    await page.goto("/en/onboarding");
    await expect(page.getByRole("heading", { name: "Your account type is Worker" })).toBeVisible();

    await callAs(user, "withdraw_consent", { p_purpose: "worker-terms" });
    expect(accountRows(user.id).consents.at(-1)).toMatchObject({
      purpose: "worker-terms",
      action: "withdrawn",
    });

    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(/\/en\/onboarding$/);

    const second = await browser.newContext();
    await signInBrowser(second, user);
    const held = await second.newPage();
    await held.goto("/en/onboarding");
    await expect(held).toHaveURL(/\/en\/consent/);
    await expect(held.getByRole("heading", { name: /Worker Terms/ })).toBeVisible();
    await held.getByRole("checkbox").check();
    await held.getByRole("button", { name: "Accept and continue" }).click();
    await expect(held).toHaveURL(/\/en\/onboarding$/);
    expect(accountRows(user.id).consents.at(-1)).toMatchObject({
      purpose: "worker-terms",
      action: "granted",
    });
  } finally {
    await deleteTestUser(user.id);
  }
});
