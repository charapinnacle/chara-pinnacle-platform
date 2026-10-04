import { expectNoAxeViolations } from "./support/axe";
import { createCommittedUser, decodeSession, enrollTotp, expireAccessToken, sessionClaims } from "./support/login";
import { logIn } from "./support/login-page";
import {
  challengeCounts,
  CODE_FORMAT,
  codeField,
  enterCode,
  factorRows,
  LIMIT,
  recoveryCodeSets,
  removeFactors,
  setupKey,
  staffUser,
  verifyButton,
  WRONG_CODE,
} from "./support/mfa";
import { registerOrganization, signInAsEmployer, uniqueName } from "./support/organizations";
import { captureActionRequests } from "./support/server-action";
import { expect, test } from "./support/test";
import { totpCode } from "./support/totp";

async function newOwner() {
  const user = await createCommittedUser("company");
  await registerOrganization(user, uniqueName("Mfa Bau GmbH"));
  return user;
}

test.describe("two-step verification: enrolment", () => {
  test("FR-A4 AC1: an owner enrols a factor from the shown secret, reaches aal2 and returns to the requested page", async ({
    page,
  }) => {
    const user = await newOwner();
    await signInAsEmployer(page, user);
    expect((await sessionClaims(page.context())).aal).toBe("aal1");

    await page.goto(`/en/mfa?next=${encodeURIComponent("/en/legal/terms-of-service")}`);
    await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
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
    await enterCode(page, await setupKey(page));
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await expect(page.getByRole("main").getByRole("listitem").first()).toHaveText(
      "Set up two-step verification (done)",
    );
    expect((await sessionClaims(page.context())).aal).toBe("aal2");
  });

  test("FR-A4 AC2: a wrong or malformed code is refused at enrolment, the field keeps the focus and nothing is verified", async ({
    page,
  }) => {
    const user = await newOwner();
    await signInAsEmployer(page, user);
    await page.goto("/en/mfa");
    const secret = await setupKey(page);
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
    await enterCode(page, await setupKey(page));
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

test.describe("two-step verification: platform staff", () => {
  for (const role of ["admin", "verification_reviewer", "trust_safety"] as const) {
    test(`FR-A4 AC4: staff with the role ${role} are held at the MFA page for the administration and return to it after the code`, async ({
      page,
    }) => {
      const user = await staffUser(role);
      await logIn(page, user);
      await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
      await page.goto("/en/admin");
      await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/admin")}`);
      await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();

      await enterCode(page, await setupKey(page));
      await expect(page).toHaveURL(/\/en\/admin$/);
      await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    });
  }

  test("FR-A4 AC4: a revoked staff member and an ordinary employer get the forbidden page without an MFA prompt", async ({
    page,
  }) => {
    for (const user of [await staffUser("admin", true), await newOwner()]) {
      await logIn(page, user);
      await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
      await page.goto("/en/admin");
      await expect(page).toHaveURL(/\/en\/forbidden$/);
      await expect(page.getByRole("heading", { name: "You do not have access to this page" })).toBeVisible();
      expect(factorRows(user.id)).toEqual([]);
    }
  });

  test("FR-A4 AC4: enrolled staff are asked for the code, not for a new enrolment, and an aal2 session passes", async ({
    page,
  }) => {
    const user = await staffUser("admin");
    const secret = await enrollTotp(user);
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto("/en/admin");
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/admin")}`);
    await expect(page.getByRole("heading", { name: "Verify it is you" })).toBeVisible();
    await enterCode(page, secret);
    await expect(page).toHaveURL(/\/en\/admin$/);
    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
  });
});

test.describe("two-step verification: backup factor and sessions", () => {
  test("FR-A4 AC6: an owner adds a backup device, logs in with either code, cannot add a third and sees no recovery codes", async ({
    page,
    browser,
  }) => {
    const user = await newOwner();
    await signInAsEmployer(page, user);
    await page.goto("/en/mfa");
    const primary = await setupKey(page);
    await enterCode(page, primary);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);

    await page.goto("/en/mfa");
    await expect(page.getByRole("heading", { name: "Two-step verification is on" })).toBeVisible();
    await expect(page.getByText("Authenticator", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Device name")).toHaveValue("Backup");

    await page.getByLabel("Device name").fill("Authenticator");
    await page.getByRole("button", { name: "Add a backup device" }).click();
    await expect(page.getByText("You already use this name for another device.")).toBeVisible();

    await page.getByLabel("Device name").fill("Backup phone");
    await page.getByRole("button", { name: "Add a backup device" }).click();
    await expect(page.getByRole("heading", { name: "Add a backup device" })).toBeVisible();
    const backup = await setupKey(page);
    expect(backup).not.toBe(primary);
    await expectNoAxeViolations(page);
    await enterCode(page, backup);
    await expect(page.getByText("Backup phone", { exact: true })).toBeVisible();
    await expect(page.getByText(LIMIT)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a backup device" })).toHaveCount(0);
    expect(factorRows(user.id)).toEqual([
      { friendly_name: "Authenticator", status: "verified", factor_type: "totp" },
      { friendly_name: "Backup phone", status: "verified", factor_type: "totp" },
    ]);
    await expectNoAxeViolations(page);

    for (const [secret, label] of [
      [backup, "the backup"],
      [primary, "the primary"],
    ] as const) {
      const context = await browser.newContext();
      const fresh = await context.newPage();
      await logIn(fresh, user);
      await expect(fresh).toHaveURL(/\/en\/dashboard\/employer$/);
      expect((await sessionClaims(context)).aal, label).toBe("aal1");
      await fresh.goto("/en/mfa");
      await expect(fresh.getByText("either of your authenticator apps")).toBeVisible();
      await enterCode(fresh, secret);
      await expect(fresh, label).toHaveURL(/\/en\/dashboard\/employer$/);
      expect((await sessionClaims(context)).aal, label).toBe("aal2");
      await context.close();
    }

    expect(recoveryCodeSets(user.id)).toBe(0);
    await expect(page.getByText(/recovery code/i)).toHaveCount(0);
  });

  test("FR-A4 AC6: an enrolment that was abandoned is replaced and does not count toward the limit", async ({ page }) => {
    const user = await newOwner();
    await signInAsEmployer(page, user);
    await page.goto("/en/mfa");
    await setupKey(page);
    expect(factorRows(user.id).map((row) => row.status)).toEqual(["unverified"]);

    await page.goto("/en/mfa");
    const secret = await setupKey(page);
    expect(factorRows(user.id)).toEqual([
      { friendly_name: "Authenticator", status: "unverified", factor_type: "totp" },
    ]);
    await enterCode(page, secret);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    expect(factorRows(user.id).map((row) => row.status)).toEqual(["verified"]);

    await page.goto("/en/mfa");
    await page.getByLabel("Device name").fill("Backup phone");
    await page.getByRole("button", { name: "Add a backup device" }).click();
    await setupKey(page);
    await page.goto("/en/mfa");
    await page.getByLabel("Device name").fill("Backup phone");
    await page.getByRole("button", { name: "Add a backup device" }).click();
    await enterCode(page, await setupKey(page));
    await expect(page.getByText(LIMIT)).toBeVisible();
    expect(factorRows(user.id).map((row) => row.status)).toEqual(["verified", "verified"]);
  });

  test("FR-A4 AC7: the session level follows the login, survives a token refresh and starts at aal1 again", async ({
    page,
  }) => {
    const user = await staffUser("admin");
    const secret = await enrollTotp(user);
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    expect((await sessionClaims(page.context())).aal).toBe("aal1");

    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: "Verify it is you" })).toBeVisible();
    await enterCode(page, secret);
    await expect(page).toHaveURL(/\/en\/admin$/);
    expect((await sessionClaims(page.context())).aal).toBe("aal2");
    const refreshToken = decodeSession(await page.context().cookies()).refresh_token;

    await expireAccessToken(page.context());
    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    const refreshed = decodeSession(await page.context().cookies());
    expect(refreshed.refresh_token).not.toBe(refreshToken);
    expect(refreshed.expires_at).toBeGreaterThan(Date.now() / 1000);
    expect((await sessionClaims(page.context())).aal).toBe("aal2");

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/en\/login$/);
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    expect((await sessionClaims(page.context())).aal).toBe("aal1");
    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: "Verify it is you" })).toBeVisible();
  });

  test("FR-A4 AC10: after the factors were removed the next protected page asks to enrol again", async ({ page }) => {
    const user = await staffUser("admin");
    await enrollTotp(user);
    await removeFactors(user.id);
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
    await enterCode(page, await setupKey(page));
    await expect(page).toHaveURL(/\/en\/admin$/);
  });
});
