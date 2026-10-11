import "server-only";
import type { AuthError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import * as z from "zod";
import { GENERIC_FAILURE, isAddressThrottle, isRateLimit, logAuthFailure, RATE_LIMITED, rateLimitedFor } from "@/lib/auth-errors";
import { throttleWait } from "@/lib/dal/rate-limit";
import { env } from "@/lib/env";
import { defaultLocale } from "@/lib/i18n/locale";
import { emailSchema } from "@/lib/validation/sign-up";

const NAME = "chara_pending_email";
const LIFETIME_SECONDS = 30 * 60;
const PREFILL_NAME = "chara_prefill_email";
const PREFILL_LIFETIME_SECONDS = 60;

// The shortest time between two emails to one address: the same 60 s as max_frequency of Auth (supabase/config.toml, the
// hosted project), which answers a faster request without sending.
export const RESEND_COOLDOWN_SECONDS = 60;

type PendingPurpose = "signup" | "recovery";

const pendingSchema = z.object({
  purpose: z.enum(["signup", "recovery"]),
  email: emailSchema,
  sentAt: z.number().int().positive(),
});

type PendingEmail = z.infer<typeof pendingSchema>;

export type ResendAnswer = { cooldown: number; sent?: true; message?: string };

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NEXT_PUBLIC_SITE_URL.startsWith("https:"),
    path: `/${defaultLocale}`,
    maxAge,
  } as const;
}

async function readCookie(name: string, purpose: PendingPurpose): Promise<PendingEmail | null> {
  const raw = (await cookies()).get(name)?.value;
  if (!raw) return null;
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.purpose === purpose ? parsed.data : null;
  } catch {
    return null;
  }
}

// The address a confirmation or reset link was sent to is kept here, not in the address of a page: the check-your-email page
// shows it masked and resends to it. The cookie is not readable by scripts, is sent only to the pages of the site's own
// language (the pages that read it have no longer path in common), lives 30 minutes and is removed when the link is used.
// It is not signed: a person who edits their own copy changes only their own cooldown display and its pre-check, and the real
// limits stay with the throttle (rate_limit_attempt) and the minimum interval of Auth.
export async function rememberPendingEmail(purpose: PendingPurpose, email: string): Promise<void> {
  const value: PendingEmail = { purpose, email, sentAt: Date.now() };
  const store = await cookies();
  store.set(NAME, JSON.stringify(value), cookieOptions(LIFETIME_SECONDS));
  store.delete({ name: PREFILL_NAME, path: `/${defaultLocale}` });
}

export function pendingEmail(purpose: PendingPurpose): Promise<PendingEmail | null> {
  return readCookie(NAME, purpose);
}

// The form is filled with the address again only for the minute after the person chose "Use a different address", so that
// the next visitor of a shared computer does not find it there.
export async function offerPendingEmailAgain(purpose: PendingPurpose): Promise<void> {
  const pending = await pendingEmail(purpose);
  if (pending) (await cookies()).set(PREFILL_NAME, JSON.stringify(pending), cookieOptions(PREFILL_LIFETIME_SECONDS));
}

export async function prefilledEmail(purpose: PendingPurpose): Promise<string | undefined> {
  return (await readCookie(PREFILL_NAME, purpose))?.email;
}

export async function forgetPendingEmail(): Promise<void> {
  const store = await cookies();
  store.delete({ name: NAME, path: `/${defaultLocale}` });
  store.delete({ name: PREFILL_NAME, path: `/${defaultLocale}` });
}

export function cooldownLeft(sentAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((Math.min(sentAt, now) + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000));
}

// "a*****6@gmail.com": the first and the last character of the name, five stars between so that its length is not shown.
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  const name = email.slice(0, at);
  const hidden = name.length > 2 ? `${name[0]}*****${name.at(-1)}` : `${name[0]}*****`;
  return `${hidden}${email.slice(at)}`;
}

type Send = (email: string) => Promise<AuthError | null>;

// The Resend button of the check-your-email pages: no address is asked for, the one in the cookie is used. The cooldown check
// here is a courtesy (the cookie is the person's own copy); the limits are the throttle of the form and the minimum interval of
// Auth. An address that cannot be used is answered as any other (as Auth does), so the page reveals nothing about the account.
export async function resendPending(
  purpose: PendingPurpose,
  action: "resend" | "forgot_password",
  formPath: string,
  send: Send,
): Promise<ResendAnswer> {
  const pending = await pendingEmail(purpose);
  if (!pending) redirect(`/${defaultLocale}${formPath}`);
  const waiting = cooldownLeft(pending.sentAt);
  if (waiting > 0) return { cooldown: waiting };
  const retryAfter = await throttleWait(action);
  if (retryAfter > 0) return { cooldown: 0, message: rateLimitedFor(retryAfter) };
  const error = await send(pending.email);
  if (error && isRateLimit(error)) return { cooldown: 0, message: RATE_LIMITED };
  if (error && !isAddressThrottle(error)) {
    logAuthFailure("Resend", error);
    return { cooldown: 0, message: GENERIC_FAILURE };
  }
  await rememberPendingEmail(purpose, pending.email);
  return { cooldown: RESEND_COOLDOWN_SECONDS, sent: true };
}
