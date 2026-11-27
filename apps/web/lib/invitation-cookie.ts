import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { invitationTokenSchema } from "@/lib/validation/team";

const NAME = "chara_invitation";
const INVITATION_DAYS = 7;

// A person who registers from an invitation link confirms the address later, possibly after other pages; the link
// is kept in this cookie until onboarding hands it back, so that they are not asked to create a company of their own.
export async function rememberInvitation(token: string): Promise<void> {
  (await cookies()).set(NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NEXT_PUBLIC_SITE_URL.startsWith("https:"),
    path: "/",
    maxAge: INVITATION_DAYS * 86_400,
  });
}

// The cookie of this browser, else the invitation the account was registered with (its user metadata): a person who
// confirms the address on another device or in a mail app's browser still reaches the invitation, not a company form.
// The token only ever joins the address it was sent to, which accept_invitation checks.
export async function pendingInvitationToken(): Promise<string | null> {
  const fromCookie = invitationTokenSchema.safeParse((await cookies()).get(NAME)?.value);
  if (fromCookie.success) return fromCookie.data;
  const { data } = await (await createClient()).auth.getClaims();
  const fromAccount = invitationTokenSchema.safeParse(data?.claims.user_metadata?.[INVITATION_METADATA]);
  return fromAccount.success ? fromAccount.data : null;
}

// The key of the invitation in the user metadata of an account registered from an invitation link.
export const INVITATION_METADATA = "invitation";

export async function forgetInvitation(): Promise<void> {
  (await cookies()).delete(NAME);
}
