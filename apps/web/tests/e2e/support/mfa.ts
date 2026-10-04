import type { BrowserContext, Page } from "@playwright/test";
import { execute, literal, query } from "./db";
import { expect } from "./test";
import { createCommittedUser } from "./login";
import { registerOrganization, uniqueName } from "./organizations";
import type { ActionCall } from "./server-action";
import { adminRequest, type TestUser } from "./test-user";
import { totpCode } from "./totp";

export const WRONG_CODE = "That code is incorrect or has expired. Try again.";
export const CODE_FORMAT = "Enter the 6-digit code from your authenticator app.";
export const LIMIT = "You can register at most two authenticator devices.";
export const AAL2_FIRST = "Enter a code from your authenticator app first, then change your devices.";
export const THROTTLED = "Too many attempts. Try again in a few minutes.";

export async function newOwner() {
  const user = await createCommittedUser("company");
  await registerOrganization(user, uniqueName("Mfa Bau GmbH"));
  return user;
}

// The first factor is created by a click, not by the render of the page.
export async function beginSetup(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Show the QR code" }).click();
  return setupKey(page);
}

export async function addTwoDevices(page: Page): Promise<{ primary: string; backup: string }> {
  await page.goto("/en/mfa");
  const primary = await beginSetup(page);
  await enterCode(page, primary);
  await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
  await page.goto("/en/mfa");
  await page.getByLabel("Device name").fill("Backup phone");
  await page.getByRole("button", { name: "Add a backup device" }).click();
  const backup = await setupKey(page);
  await enterCode(page, backup);
  await expect(page.getByText(LIMIT)).toBeVisible();
  return { primary, backup };
}

// Posts a Server Action again, as a crafted request would, from the session of another context.
export async function replayAction(
  context: BrowserContext,
  call: ActionCall,
  change: (args: Record<string, unknown>) => Record<string, unknown>,
): Promise<string> {
  const [args] = JSON.parse(call.body) as [Record<string, unknown>];
  const response = await context.request.post("/en/mfa", {
    headers: { "next-action": call.id, "content-type": call.contentType },
    data: JSON.stringify([change(args)]),
  });
  return response.text();
}

export function codeField(page: Page) {
  return page.getByLabel("Authentication code");
}

export function verifyButton(page: Page) {
  return page.getByRole("button", { name: "Verify and continue" });
}

export async function setupKey(page: Page): Promise<string> {
  const key = (await page.locator("code").innerText()).trim();
  expect(key).toMatch(/^[A-Z2-7]{16,}$/);
  return key;
}

export async function enterCode(page: Page, secret: string): Promise<void> {
  await codeField(page).fill(totpCode(secret));
  await verifyButton(page).click();
}

export function factorRows(userId: string) {
  return query<{ friendly_name: string; status: string; factor_type: string }>(
    `select friendly_name, status::text, factor_type::text from auth.mfa_factors
     where user_id = ${literal(userId)} order by created_at`,
  );
}

// The data of the KPI "MFA challenge failure rate": Auth keeps one challenge per submitted code, because the page checks
// the device the user chose, and sets verified_at on success.
export function challengeCounts(userId: string) {
  const [counts] = query<{ attempts: number; verified: number }>(
    `select count(*)::int as attempts, count(c.verified_at)::int as verified
     from auth.mfa_challenges c join auth.mfa_factors f on f.id = c.factor_id where f.user_id = ${literal(userId)}`,
  );
  return counts;
}

export function recoveryCodeSets(userId: string): number {
  return query<{ id: string }>(
    `select s.id from auth.mfa_recovery_code_sets s join auth.mfa_factors f on f.id = s.mfa_factor_id
     where f.user_id = ${literal(userId)}`,
  ).length;
}

export async function staffUser(role: "admin" | "verification_reviewer" | "trust_safety", revoked = false): Promise<TestUser> {
  const user = await createCommittedUser("company");
  execute(
    `insert into public.platform_staff (user_id, role, revoked_at)
     values (${literal(user.id)}, ${literal(role)}, ${revoked ? "now()" : "null"})`,
  );
  return user;
}

export async function removeFactors(userId: string): Promise<void> {
  for (const { id } of query<{ id: string }>(`select id from auth.mfa_factors where user_id = ${literal(userId)}`)) {
    await adminRequest(`/users/${userId}/factors/${id}`, { method: "DELETE" });
  }
}
