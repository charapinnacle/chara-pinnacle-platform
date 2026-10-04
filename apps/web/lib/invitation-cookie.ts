import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
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

export async function pendingInvitationToken(): Promise<string | null> {
  const value = (await cookies()).get(NAME)?.value;
  const parsed = invitationTokenSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function forgetInvitation(): Promise<void> {
  (await cookies()).delete(NAME);
}
