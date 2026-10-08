import type { Page } from "@playwright/test";
import { enrolledStaff, revokeRole, signInStaff } from "./support/admin";
import { execute, literal } from "./support/db";
import { createCommittedUser, enrollTotp } from "./support/login";
import { logIn } from "./support/login-page";
import { enterCode, newOwner, staffUser } from "./support/mfa";
import { signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

const ADMIN_ENTRIES = ["Users", "Organisations", "Statistics", "Legal documents", "Audit log", "Staff", "MFA reset"];
// The entry for vacancy moderation arrives with FR-C7.
const TRUST_ENTRIES = ["Users", "Organisations", "Suspensions and reinstatements"];

async function entries(page: Page): Promise<string[]> {
  return page.getByRole("navigation", { name: "Administration" }).getByRole("link").allInnerTexts();
}

// Staff outside the role of a page get the same answer as everyone else; only they see the navigation of their own role.
async function expectNotFound(page: Page, path: string, { staff = true } = {}): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Administration" })).toHaveCount(0);
  if (!staff) await expect(page.getByRole("navigation", { name: "Administration" })).toHaveCount(0);
}

test.describe("the administration console: who gets in and what each role sees", () => {
  test("FR-F1 AC1: a visitor is sent to log in and returns to the console after logging in", async ({ page }) => {
    await page.goto("/en/admin");
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent("/en/admin")}`);
    await page.goto("/en/admin/audit");
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent("/en/admin/audit")}`);
  });

  test("FR-F1 AC1: a candidate and an employer owner get the not-found page with status 404 and no console markup", async ({ page }) => {
    for (const user of [await createCommittedUser("worker"), await newOwner()]) {
      await logIn(page, user);
      await expect(page).not.toHaveURL(/\/en\/login/);
      await expectNotFound(page, "/en/admin", { staff: false });
      await expectNotFound(page, "/en/admin/users", { staff: false });
      await expectNotFound(page, "/en/admin/audit", { staff: false });
      await page.context().clearCookies();
    }
  });

  test("FR-F1 AC1: a staff member whose role is revoked in the database is refused from the first request after", async ({ page }) => {
    const staff = await signInStaff(page, "trust_safety");
    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    await page.goto("/en/admin/users");
    await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();

    revokeRole(staff.user.id);
    await expectNotFound(page, "/en/admin", { staff: false });
    await expectNotFound(page, "/en/admin/users", { staff: false });
  });

  test("FR-F1 AC1: an administrator without a factor is asked to enrol and one with a factor to enter the code, and reaches the console after it", async ({
    page,
  }) => {
    const fresh = await staffUser("admin");
    await logIn(page, fresh);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto("/en/admin");
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/admin")}`);
    await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
    await page.context().clearCookies();

    const enrolled = await staffUser("admin");
    const secret = await enrollTotp(enrolled);
    await logIn(page, enrolled);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto("/en/admin");
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/admin")}`);
    await expect(page.getByRole("heading", { name: "Verify it is you" })).toBeVisible();
    await page.goto("/en/admin/audit");
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/admin/audit")}`);
    await enterCode(page, secret);
    await expect(page).toHaveURL("/en/admin/audit");
    await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
  });

  test("FR-F1 AC1: the Platform Administrator has seven entries, none for plans, limits or settings, and no page of the Trust & Safety role", async ({
    page,
  }) => {
    await signInStaff(page, "admin");
    await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();
    expect(await entries(page)).toEqual(ADMIN_ENTRIES);
    for (const forbidden of [/plans/i, /limits/i, /settings/i]) {
      await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: forbidden })).toHaveCount(0);
    }
    for (const path of ["/en/admin/moderation", "/en/admin/suspensions", "/en/admin/plans", "/en/admin/settings"]) {
      await expectNotFound(page, path);
    }
    for (const path of ["users", "organizations", "statistics", "legal", "audit", "staff", "mfa-reset"]) {
      const response = await page.goto(`/en/admin/${path}`);
      expect(response?.status(), path).toBe(200);
    }
  });

  test("FR-F1 AC1: the Trust & Safety Administrator has the entries of the role and gets not found for the audit log and the other pages of the administrator", async ({
    page,
  }) => {
    await signInStaff(page, "trust_safety");
    expect(await entries(page)).toEqual(TRUST_ENTRIES);
    for (const path of ["audit", "statistics", "legal", "staff", "mfa-reset", "moderation"]) {
      await expectNotFound(page, `/en/admin/${path}`);
    }
    for (const path of ["users", "organizations", "suspensions"]) {
      const response = await page.goto(`/en/admin/${path}`);
      expect(response?.status(), path).toBe(200);
    }
  });

  test("FR-F1 AC1: the Verification Reviewer sees one page saying no function is available and no navigation entries, and every other page is not found", async ({
    page,
  }) => {
    await signInStaff(page, "verification_reviewer");
    await expect(page.getByText("No functions are available for your role in this release.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Administration" })).toHaveCount(0);
    for (const path of ["users", "organizations", "audit", "suspensions", "staff"]) {
      await expectNotFound(page, `/en/admin/${path}`, { staff: false });
    }
  });

  test("FR-A7 AC11: an administrator who also holds the Trust & Safety role has the entries of both", async ({ page }) => {
    const staff = await enrolledStaff("admin");
    execute(`insert into public.platform_staff (user_id, role) values (${literal(staff.user.id)}, 'trust_safety')`);
    await signInAtAal2(page, staff.user, staff.secret, "/en/admin");
    expect(await entries(page)).toEqual([...ADMIN_ENTRIES, "Suspensions and reinstatements"]);
  });
});
