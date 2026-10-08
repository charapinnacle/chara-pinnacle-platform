import { enrollTotp } from "./support/login";
import { logIn } from "./support/login-page";
import { beginSetup, enterCode, factorRows, newOwner, staffUser } from "./support/mfa";
import { expect, test } from "./support/test";

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

      await enterCode(page, await beginSetup(page));
      await expect(page).toHaveURL(/\/en\/admin$/);
      await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    });
  }

  test("FR-A4 AC4: a revoked staff member and an ordinary employer get the not-found page of FR-F1 AC1 without an MFA prompt", async ({
    page,
  }) => {
    for (const user of [await staffUser("admin", true), await newOwner()]) {
      await logIn(page, user);
      await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
      const response = await page.goto("/en/admin");
      expect(response?.status()).toBe(404);
      await expect(page).toHaveURL(/\/en\/admin$/);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
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
