import { expectNoAxeViolations } from "./support/axe";
import { decodeSession, enrollTotp, expireAccessToken, sessionClaims } from "./support/login";
import { logIn } from "./support/login-page";
import {
  AAL2_FIRST,
  addTwoDevices,
  beginSetup,
  challengeCounts,
  codeField,
  enterCode,
  factorRows,
  LIMIT,
  newOwner,
  recoveryCodeSets,
  removeFactors,
  replayAction,
  setupKey,
  staffUser,
  THROTTLED,
  verifyButton,
  WRONG_CODE,
} from "./support/mfa";
import { signInAsEmployer } from "./support/organizations";
import { captureActionRequests } from "./support/server-action";
import { logOut } from "./support/app-shell";
import { expect, test } from "./support/test";
import { totpCode } from "./support/totp";

test.describe("two-step verification: devices, limits and sessions", () => {
  test("FR-A4 AC6: an owner adds a backup device, logs in with either code, cannot add a third and sees no recovery codes", async ({
    page,
    browser,
  }) => {
    const user = await newOwner();
    await signInAsEmployer(page, user);
    await page.goto("/en/mfa");
    const primary = await beginSetup(page);
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

    for (const [secret, device, label] of [
      [backup, "Backup phone", "the backup"],
      [primary, "Authenticator", "the primary"],
    ] as const) {
      const context = await browser.newContext();
      const fresh = await context.newPage();
      await logIn(fresh, user);
      await expect(fresh).toHaveURL(/\/en\/dashboard\/employer$/);
      expect((await sessionClaims(context)).aal, label).toBe("aal1");
      await fresh.goto("/en/mfa");
      await expect(fresh.getByRole("radiogroup", { name: "Device" })).toBeVisible();
      await expect(fresh.getByLabel("Authenticator", { exact: true })).toBeChecked();
      await fresh.getByLabel(device, { exact: true }).check();
      const before = challengeCounts(user.id);
      await enterCode(fresh, secret);
      await expect(fresh, label).toHaveURL(/\/en\/dashboard\/employer$/);
      expect((await sessionClaims(context)).aal, label).toBe("aal2");
      const after = challengeCounts(user.id);
      expect(after.attempts - before.attempts, `${label}: one submission is one challenge`).toBe(1);
      expect(after.verified - before.verified, `${label}: and it is verified`).toBe(1);
      await context.close();
    }

    expect(recoveryCodeSets(user.id)).toBe(0);
    await expect(page.getByText(/recovery code/i)).toHaveCount(0);
  });

  test("FR-A4 AC6: a wrong code for the chosen device is one failed challenge, not one per device", async ({
    page,
    browser,
  }) => {
    const user = await newOwner();
    await signInAsEmployer(page, user);
    const { primary, backup } = await addTwoDevices(page);
    const context = await browser.newContext();
    const fresh = await context.newPage();
    await logIn(fresh, user);
    await expect(fresh).toHaveURL(/\/en\/dashboard\/employer$/);
    await fresh.goto("/en/mfa");
    await fresh.getByLabel("Backup phone", { exact: true }).check();
    const before = challengeCounts(user.id);
    await codeField(fresh).fill(totpCode(primary));
    await verifyButton(fresh).click();
    await expect(fresh.getByText(WRONG_CODE)).toBeVisible();
    const after = challengeCounts(user.id);
    expect(after.attempts - before.attempts).toBe(1);
    expect(after.verified - before.verified).toBe(0);
    expect((await sessionClaims(context)).aal).toBe("aal1");
    await enterCode(fresh, backup);
    await expect(fresh).toHaveURL(/\/en\/dashboard\/employer$/);
    await context.close();
  });

  test("FR-A4 AC6: a third device is refused by the server, not only hidden by the page", async ({ page }) => {
    const user = await newOwner();
    await signInAsEmployer(page, user);
    const calls = captureActionRequests(page);
    await addTwoDevices(page);
    expect(factorRows(user.id).map((row) => row.status)).toEqual(["verified", "verified"]);

    const answer = await replayAction(page.context(), calls[0], (args) => ({ ...args, name: "Third device" }));
    expect(answer).toContain(LIMIT);
    expect(factorRows(user.id).map((row) => row.status)).toEqual(["verified", "verified"]);
  });

  test("FR-A4 AC5: a password-only session cannot add a factor of its own, so the second step cannot be skipped", async ({
    page,
    browser,
  }) => {
    const user = await newOwner();
    const secret = await enrollTotp(user);
    await signInAsEmployer(page, user);
    await page.goto("/en/mfa");
    await enterCode(page, secret);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto("/en/mfa");
    const calls = captureActionRequests(page);
    await page.getByLabel("Device name").fill("Backup phone");
    await page.getByRole("button", { name: "Add a backup device" }).click();
    const backup = await setupKey(page);
    await codeField(page).fill("000000");
    await verifyButton(page).click();
    await expect(page.getByText(WRONG_CODE)).toBeVisible();
    const [start, verify] = calls;
    const unverified = factorRows(user.id).filter((row) => row.status === "unverified");
    expect(unverified).toHaveLength(1);

    const attacker = await browser.newContext();
    const session = await attacker.newPage();
    await logIn(session, user);
    await expect(session).toHaveURL(/\/en\/dashboard\/employer$/);
    expect((await sessionClaims(attacker)).aal).toBe("aal1");

    expect(await replayAction(attacker, start, (args) => ({ ...args, name: "Mine" }))).toContain(AAL2_FIRST);
    const factorId = (JSON.parse(verify.body) as [{ factorId: string }])[0].factorId;
    expect(
      await replayAction(attacker, verify, (args) => ({ ...args, factorId, code: totpCode(backup) })),
    ).toContain(AAL2_FIRST);
    expect((await sessionClaims(attacker)).aal).toBe("aal1");
    expect(factorRows(user.id).map((row) => row.status).sort()).toEqual(["unverified", "verified"]);
    await session.goto("/en/mfa");
    await expect(session.getByRole("heading", { name: "Verify it is you" })).toBeVisible();
    await attacker.close();
  });

  test("FR-A4 NFR-S6: the code check is limited per visitor and Auth is not asked once the limit is reached", async ({
    page,
  }) => {
    const user = await newOwner();
    await enrollTotp(user);
    await signInAsEmployer(page, user);
    await page.goto("/en/mfa");
    const before = challengeCounts(user.id).attempts;
    for (let attempt = 0; attempt < 10; attempt++) {
      await codeField(page).fill("000000");
      await verifyButton(page).click();
      await expect(page.getByText(WRONG_CODE)).toBeVisible();
    }
    await codeField(page).fill("000000");
    await verifyButton(page).click();
    await expect(page.getByText(THROTTLED)).toBeVisible();
    expect(challengeCounts(user.id).attempts - before).toBe(10);
    expect((await sessionClaims(page.context())).aal).toBe("aal1");
  });

  test("FR-A4 AC6: an enrolment that was abandoned is replaced and does not count toward the limit", async ({ page }) => {
    const user = await newOwner();
    await signInAsEmployer(page, user);
    await page.goto("/en/mfa");
    await beginSetup(page);
    expect(factorRows(user.id).map((row) => row.status)).toEqual(["unverified"]);

    await page.goto("/en/mfa");
    const secret = await beginSetup(page);
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

    await logOut(page);
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
    await enterCode(page, await beginSetup(page));
    await expect(page).toHaveURL(/\/en\/admin$/);
  });
});
