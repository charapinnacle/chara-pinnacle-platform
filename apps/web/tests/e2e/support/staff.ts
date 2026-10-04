import { env } from "@/lib/env";
import { totpCode } from "./totp";
import type { TestUser } from "./test-user";

function auth(path: string, body: Record<string, unknown>, bearer?: string): Promise<Response> {
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

// A token at aal2 for a user whose factor is enrolled: password first, then the code of the factor.
export async function aal2Token(user: TestUser, secret: string): Promise<string> {
  const login = (await (
    await auth("/token?grant_type=password", { email: user.email, password: user.password })
  ).json()) as { access_token: string };
  const { factors } = (await (
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${login.access_token}` },
    })
  ).json()) as { factors: { id: string }[] };
  const challenge = (await (await auth(`/factors/${factors[0].id}/challenge`, {}, login.access_token)).json()) as {
    id: string;
  };
  const verified = await auth(
    `/factors/${factors[0].id}/verify`,
    { challenge_id: challenge.id, code: totpCode(secret) },
    login.access_token,
  );
  if (!verified.ok) throw new Error(`The code was refused with ${verified.status}`);
  return ((await verified.json()) as { access_token: string }).access_token;
}

export async function callRpc(token: string, rpc: string, args: Record<string, unknown>) {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  return { status: response.status, body: await response.text() };
}
