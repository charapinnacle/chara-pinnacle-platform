import { expectNoAxeViolations } from "./support/axe";
import { createCommittedUser, enrollTotp, sessionClaims } from "./support/login";
import { logIn } from "./support/login-page";
import {
  beginSetup,
  challengeCounts,
  CODE_FORMAT,
  codeField,
  enterCode,
  factorRows,
  newOwner,
  setupKey,
  verifyButton,
  WRONG_CODE,
} from "./support/mfa";
import { signInAsEmployer } from "./support/organizations";
import { captureActionRequests } from "./support/server-action";
import { expect, test } from "./support/test";
import { totpCode } from "./support/totp";

test.describe("two-step verification: enrolment", () => {
  test("FR-A4 AC1: an owner enrols a factor from the shown secret, reaches aal2 and returns to the requested page", async ({
    page,
  }) => {
    const user = await newOwner();
    await signInAsEmployer(page, user);
    expect((await sessionClaims(page.context())).aal).toBe("aal1");

    await page.goto(`/en/mfa?next=${encodeURIComponent("/en/legal/terms-of-service")}`);
    await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
    await expect(page.getByRole("img", { name: /^QR code/ })).toHaveCount(0);
    expect(factorRows(user.id)).toEqual([]);
    await page.getByRole("button", { name: "Show the QR code" }).click();
    const qr = page.getByRole("img", { name: /^QR code to add CHARA to your authenticator app/ });
    await expect(qr).toBeVisible();
    expect(await qr.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    const secret = await setupKey(page);
    await expect(page.getByText(secret, { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    await enterCode(page, secret);
    await expect(page).toHaveURL(/\/en\/legal\/terms-of-service$/);
    expect(factorRows(user.id)).toEqual([
      { friendly_name: "Authenticator", status: "verified", factor_type: "totp" },
    ]);
    expect((await sessionClaims(page.context())).aal).toBe("aal2");
  });

  test("FR-A4 AC1: without a requested page the owner lands on the dashboard, where the first step is done", async ({
    page,
  }) => {
    const user = await newOwner();
    await signInAsEmployer(page, user);
    await page.getByRole("link", { name: "Set up two-step verification" }).click();
    await expect(page).toHaveURL(/\/en\/mfa$/);
    await enterCode(page, await beginSetup(page));
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await expect(
      page.getByRole("main").getByRole("listitem").filter({ hasText: "Set up two-step verification" }),
    ).toHaveText("Set up two-step verification (done)");
    expect((await sessionClaims(page.context())).aal).toBe("aal2");
  });

  test("FR-A4 AC2: a wrong or malformed code is refused at enrolment, the field keeps the focus and nothing is verified", async ({
    page,
  }) => {
    const user = await newOwner();
    await signInAsEmployer(page, user);
    await page.goto("/en/mfa");
    const secret = await beginSetup(page);
    const requests = captureActionRequests(page);
    const field = codeField(page);
    await expect(field).toHaveAttribute("inputmode", "numeric");
    await expect(field).toHaveAttribute("autocomplete", "one-time-code");

    await field.fill("000000");
    await verifyButton(page).click();
    await expect(page.getByText(WRONG_CODE)).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");
    expect(requests).toHaveLength(1);
    expect(factorRows(user.id).map((row) => row.status)).toEqual(["unverified"]);
    expect((await sessionClaims(page.context())).aal).toBe("aal1");

    for (const malformed of ["12345", "12a456"]) {
      await field.fill(malformed);
      await verifyButton(page).click();
      await expect(page.getByText(CODE_FORMAT)).toBeVisible();
      await expect(field).toBeFocused();
    }
    expect(requests).toHaveLength(1);
    expect(factorRows(user.id).map((row) => row.status)).toEqual(["unverified"]);

    await enterCode(page, secret);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    expect(factorRows(user.id).map((row) => row.status)).toEqual(["verified"]);
    expect(challengeCounts(user.id)).toEqual({ attempts: 2, verified: 1 });
  });

  test("FR-A4 AC2: the code of the challenge is checked the same way and the session stays at aal1 until it is right", async ({
    page,
  }) => {
    const user = await newOwner();
    const secret = await enrollTotp(user);
    await signInAsEmployer(page, user);
    await page.goto("/en/mfa");
    await expect(page.getByRole("heading", { name: "Verify it is you" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toHaveCount(0);
    await expectNoAxeViolations(page);
    const requests = captureActionRequests(page);
    const field = codeField(page);
    await expect(field).toHaveAttribute("inputmode", "numeric");
    await expect(field).toHaveAttribute("autocomplete", "one-time-code");

    await field.fill("000000");
    await verifyButton(page).click();
    await expect(page.getByText(WRONG_CODE)).toBeVisible();
    await expect(field).toBeFocused();
    expect(requests).toHaveLength(1);
    expect((await sessionClaims(page.context())).aal).toBe("aal1");

    for (const malformed of ["12345", "12a456"]) {
      await field.fill(malformed);
      await verifyButton(page).click();
      await expect(page.getByText(CODE_FORMAT)).toBeVisible();
    }
    expect(requests).toHaveLength(1);

    await field.fill(`${totpCode(secret).slice(0, 3)} ${totpCode(secret).slice(3)}`);
    await verifyButton(page).click();
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    expect((await sessionClaims(page.context())).aal).toBe("aal2");
  });

  test("FR-A4 AC3: a candidate is never sent to the MFA page, and the page stays open to them", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.goto("/en/mfa");
    await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
    await enterCode(page, await beginSetup(page));
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    expect((await sessionClaims(page.context())).aal).toBe("aal2");
  });

  test("FR-A4 AC3: an employer without two-step verification is not held back from the dashboard", async ({ page }) => {
    await signInAsEmployer(page, await newOwner());
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    expect(page.url()).not.toContain("/mfa");
  });

  test("FR-A4: the pages need a session and carry the guidance in a 360 px viewport without overflow", async ({
    page,
    browser,
  }) => {
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    await visitor.goto("/en/mfa?next=%2Fen%2Fadmin");
    await expect(visitor).toHaveURL(/\/en\/login\?next=/);
    await anonymous.close();

    await page.setViewportSize({ width: 360, height: 740 });
    await signInAsEmployer(page, await newOwner());
    await page.goto("/en/mfa");
    await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});
