import { env } from "@/lib/env";
import { authFetch } from "./login";
import { totpCode } from "./totp";
import type { TestUser } from "./test-user";

// A token at aal2 for a user whose factor is enrolled: password first, then the code of the factor.
export async function aal2Token(user: TestUser, secret: string): Promise<string> {
  const login = (await (
    await authFetch("/token?grant_type=password", { email: user.email, password: user.password })
  ).json()) as { access_token: string };
  const { factors } = (await (
    await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${login.access_token}` },
    })
  ).json()) as { factors: { id: string }[] };
  const challenge = (await (await authFetch(`/factors/${factors[0].id}/challenge`, {}, login.access_token)).json()) as {
    id: string;
  };
  const verified = await authFetch(
    `/factors/${factors[0].id}/verify`,
    { challenge_id: challenge.id, code: totpCode(secret) },
    login.access_token,
  );
  if (!verified.ok) throw new Error(`The code was refused with ${verified.status}`);
  return ((await verified.json()) as { access_token: string }).access_token;
}
