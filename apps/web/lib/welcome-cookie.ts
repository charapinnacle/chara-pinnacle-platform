import "server-only";
import { cookies } from "next/headers";
import * as z from "zod";
import { env } from "@/lib/env";
import { onboardingPath } from "@/lib/routes";
import { defaultLocale } from "@/lib/i18n/locale";

const NAME = "chara_welcome";
const LIFETIME_SECONDS = 10 * 60;

// The welcome screen is shown once, right after the last step of onboarding: the action that finishes the last step sets
// this cookie for the account and the screen is shown only while it is there. It is removed at log-out and lives ten
// minutes, so a later sign-in lands on the dashboard. It holds the account id only, so another account signed in on the
// same browser is not welcomed by it.
export async function rememberWelcome(userId: string): Promise<void> {
  (await cookies()).set(NAME, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NEXT_PUBLIC_SITE_URL.startsWith("https:"),
    path: onboardingPath(defaultLocale, "welcome"),
    maxAge: LIFETIME_SECONDS,
  });
}

export async function welcomeIsDue(userId: string): Promise<boolean> {
  const parsed = z.uuid().safeParse((await cookies()).get(NAME)?.value);
  return parsed.success && parsed.data === userId;
}

export async function forgetWelcome(): Promise<void> {
  (await cookies()).delete({ name: NAME, path: onboardingPath(defaultLocale, "welcome") });
}
