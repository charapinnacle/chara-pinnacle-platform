import type { Page } from "@playwright/test";
import { execute, literal, query } from "./db";
import { expect } from "./test";
import { createCommittedUser } from "./login";
import { adminRequest, type TestUser } from "./test-user";
import { totpCode } from "./totp";

export const WRONG_CODE = "That code is incorrect or has expired. Try again.";
export const CODE_FORMAT = "Enter the 6-digit code from your authenticator app.";
export const LIMIT = "You can register at most two authenticator devices.";

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

// The data of the KPI "MFA challenge failure rate": Auth keeps one challenge per attempt and sets verified_at on success.
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
