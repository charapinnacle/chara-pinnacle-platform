import type { BrowserContext, Cookie, Response as PageResponse } from "@playwright/test";
import { env } from "@/lib/env";
import { callAs, pendingConsents } from "./accounts";
import { execute, literal, query } from "./db";
import { extractLinks, waitForMessage } from "./mailpit";
import { adminRequest, createTestUser, type TestUser } from "./test-user";
import { totpCode } from "./totp";

export const LOGIN_FAILED = "Email or password is incorrect.";
export const RESET_SENT = "If an account exists for this email, we have sent a reset link. Wait a minute before asking for another.";
export const LINK_EXPIRED = "This link has expired or was already used";
export const RESET_SUBJECT = "Reset your CHARA password";
export const CHANGED_SUBJECT = "Your CHARA password was changed";

const AUTH_COOKIE = /^sb-.*-auth-token(\.\d+)?$/;

export function authCookies(cookies: Cookie[]): Cookie[] {
  return cookies.filter((cookie) => AUTH_COOKIE.test(cookie.name));
}

interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export function decodeSession(cookies: Cookie[]): StoredSession {
  const joined = authCookies(cookies)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
    .map((cookie) => cookie.value)
    .join("");
  return JSON.parse(Buffer.from(joined.replace(/^base64-/, ""), "base64url").toString());
}

export function jwtClaims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

export async function sessionClaims(context: BrowserContext) {
  const { access_token } = decodeSession(await context.cookies());
  return jwtClaims(access_token) as { sub: string; aal: string; iat: number; exp: number; session_id: string };
}

export async function authSetCookies(response: PageResponse): Promise<string[]> {
  return (await response.headersArray())
    .filter(({ name }) => name.toLowerCase() === "set-cookie")
    .map(({ value }) => value)
    .filter((header) => AUTH_COOKIE.test(header.split("=")[0]));
}

const COOKIE_CHUNK_SIZE = 3180;

// Rewrites the stored session so that its access token counts as expired; the refresh token stays valid.
export async function expireAccessToken(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies();
  const name = authCookies(cookies)[0].name.replace(/\.\d+$/, "");
  const session = { ...decodeSession(cookies), expires_at: 1 };
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const chunks = value.match(new RegExp(`.{1,${COOKIE_CHUNK_SIZE}}`, "g")) ?? [];
  await context.clearCookies({ name: AUTH_COOKIE });
  await context.addCookies(
    chunks.map((chunk, index) => ({
      name: chunks.length === 1 ? name : `${name}.${index}`,
      value: chunk,
      domain: "localhost",
      path: "/",
    })),
  );
}

export function sessionRows(userId: string) {
  return query<{ id: string; created_at: string }>(
    `select id, created_at from auth.sessions where user_id = ${literal(userId)} order by created_at`,
  );
}

export function ageSessions(userId: string, interval: string): void {
  execute(
    `update auth.sessions set created_at = now() - interval ${literal(interval)} where user_id = ${literal(userId)}`,
  );
}

export function suspendProfile(userId: string): void {
  execute(`update public.profiles set status = 'suspended' where id = ${literal(userId)}`);
}

export async function banUser(userId: string): Promise<void> {
  await adminRequest(`/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ ban_duration: "876000h" }),
  });
}

export function auditRows(userId: string, action: string) {
  return query<{
    actor_id: string | null;
    entity_type: string;
    entity_id: string;
    metadata: Record<string, unknown>;
  }>(
    `select actor_id, entity_type, entity_id, metadata from audit.log
     where entity_id = ${literal(userId)} and action = ${literal(action)} order by id`,
  );
}

export function ageRecoveryLink(userId: string, interval: string): void {
  execute(
    `update auth.one_time_tokens set created_at = (now() at time zone 'utc') - interval ${literal(interval)}
     where user_id = ${literal(userId)} and token_type = 'recovery_token'`,
  );
}

// A recovery link as Auth would email it, without the per-address interval.
export async function generateRecoveryPath(email: string): Promise<string> {
  const response = await adminRequest("/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "recovery", email }),
  });
  const { hashed_token } = (await response.json()) as { hashed_token: string };
  return `/en/reset-password?token_hash=${hashed_token}`;
}

export async function emailedResetPath(email: string): Promise<string> {
  const message = await waitForMessage(email, { subject: RESET_SUBJECT });
  const link = extractLinks(message).find((url) => url.includes("/reset-password?token_hash="));
  if (!link) throw new Error("The reset email has no reset link");
  const { pathname, search } = new URL(link);
  return `${pathname}${search}`;
}

export function authFetch(path: string, body: Record<string, unknown>, bearer?: string): Promise<Response> {
  return fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1${path}`, {
    method: "POST",
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// The body is parsed when there is one: a void RPC answers 204 with none.
export async function rpcWithToken(
  accessToken: string,
  rpc: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

export async function passwordLoginStatus(user: TestUser, password: string): Promise<number> {
  return (await authFetch("/token?grant_type=password", { email: user.email, password })).status;
}

export async function verifyRecoveryStatus(tokenHash: string): Promise<number> {
  return (await authFetch("/verify", { type: "recovery", token_hash: tokenHash })).status;
}

// What the minute job does: removes recovery tokens past their lifetime so Auth no longer accepts them.
export function expireRecoveryTokens(): void {
  execute("select private.expire_recovery_tokens()");
}

export async function refreshStatus(refreshToken: string): Promise<number> {
  return (await authFetch("/token?grant_type=refresh_token", { refresh_token: refreshToken })).status;
}

// Enrols and verifies a TOTP factor for the user and returns its secret.
export async function enrollTotp(user: TestUser): Promise<string> {
  const login = await authFetch("/token?grant_type=password", {
    email: user.email,
    password: user.password,
  });
  const { access_token } = (await login.json()) as { access_token: string };
  const factor = (await (
    await authFetch("/factors", { factor_type: "totp", friendly_name: "e2e" }, access_token)
  ).json()) as { id: string; totp: { secret: string } };
  const challenge = (await (
    await authFetch(`/factors/${factor.id}/challenge`, {}, access_token)
  ).json()) as { id: string };
  const verified = await authFetch(
    `/factors/${factor.id}/verify`,
    { challenge_id: challenge.id, code: totpCode(factor.totp.secret) },
    access_token,
  );
  if (!verified.ok) throw new Error(`TOTP enrolment answered ${verified.status}`);
  return factor.totp.secret;
}

// A confirmed user whose account kind is committed, as a user is after onboarding; a worker has created the passport,
// unless the test is about onboarding itself.
export async function createCommittedUser(kind: "worker" | "company", { passport = true } = {}): Promise<TestUser> {
  const user = await createTestUser(kind, await pendingConsents(kind));
  await callAs(user, "set_account_kind");
  if (kind === "worker" && passport) {
    await callAs(user, "create_worker_passport", {
      p_first_name: "Test",
      p_last_name: "Candidate",
      p_current_country: "DE",
      p_preferred_lang: "en",
    });
  }
  // callAs signed in to get a token; tests count sessions, so leave the user with none.
  execute(`delete from auth.sessions where user_id = ${literal(user.id)}`);
  return user;
}
