import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { env } from "@/lib/env";
import { execute, literal } from "./db";
import { adminRequest, type TestUser } from "./test-user";

// The server that runs the same build with GOOGLE_SIGN_IN_ENABLED=true (playwright.config.ts).
export const GOOGLE_ON_URL = "http://localhost:3101";

export const BUTTON = "Continue with Google";

export type GoogleUser = Pick<TestUser, "id" | "email">;

// What Auth leaves behind for a first Google sign-in: a confirmed user with provider google, a Google identity and no
// password. Auth's admin API creates it with an email identity, which is swapped for the Google one here. Auth
// writes app_metadata after the insert, so the profile comes from the trigger exactly as for a Google sign-up: no kind.
export async function createGoogleUser({ emailVerified = true } = {}): Promise<GoogleUser> {
  const email = `e2e-google-${randomUUID()}@example.test`;
  const response = await adminRequest("/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      email_confirm: true,
      app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: { iss: "https://accounts.google.com", full_name: "Ana Example", email_verified: emailVerified },
    }),
  });
  const { id } = (await response.json()) as { id: string };
  execute(
    `update auth.users set encrypted_password = '' where id = ${literal(id)};
     delete from auth.identities where user_id = ${literal(id)};
     insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values (${literal(randomUUID())}, ${literal(id)},
       jsonb_build_object('sub', ${literal(randomUUID())}, 'email', ${literal(email)}, 'email_verified', ${emailVerified}),
       'google', now(), now(), now())`,
  );
  return { id, email };
}

// Clicks the button and returns the URL the browser was sent to: Auth's authorize endpoint, which is not followed
// (the local Auth has no Google client).
export async function startGoogleFlow(page: Page): Promise<URL> {
  await page.route("**/auth/v1/authorize**", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "Google would answer here" }),
  );
  const request = page.waitForRequest((candidate) => candidate.url().includes("/auth/v1/authorize"));
  await page.getByRole("button", { name: BUTTON }).click();
  return new URL((await request).url());
}

// What Auth stores when Google has sent the person back: a one-time code bound to the PKCE challenge of the browser
// that started the flow. The callback then exchanges it through Auth's real /token endpoint, which fails with a
// server error when the provider tokens are missing, so placeholders are stored.
export function issueAuthCode(userId: string, authorizeUrl: URL): string {
  const code = randomUUID();
  execute(
    `insert into auth.flow_state
       (id, user_id, auth_code, code_challenge_method, code_challenge, provider_type, authentication_method,
        provider_access_token, provider_refresh_token, auth_code_issued_at, created_at, updated_at)
     values (gen_random_uuid(), ${literal(userId)}, ${literal(code)}, 's256',
       ${literal(authorizeUrl.searchParams.get("code_challenge") ?? "")}, 'google', 'oauth',
       'provider-access-token', 'provider-refresh-token', now(), now(), now())`,
  );
  return code;
}

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
  return { status: response.status, body: await response.json() };
}
