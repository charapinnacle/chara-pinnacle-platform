import "server-only";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import * as z from "zod";
import { env } from "@/lib/env";

const NAME = "chara_welcome";
const LIFETIME_SECONDS = 10 * 60;

// The action that finishes the last step of onboarding sets this cookie for the account and the welcome screen shows
// only while it is there. It holds the account id only, so another account signed in on the same browser is not
// welcomed by it.
export async function rememberWelcome(userId: string): Promise<void> {
  (await cookies()).set(NAME, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NEXT_PUBLIC_SITE_URL.startsWith("https:"),
    path: "/",
    maxAge: LIFETIME_SECONDS,
  });
}

export async function welcomeIsDue(userId: string): Promise<boolean> {
  const parsed = z.uuid().safeParse((await cookies()).get(NAME)?.value);
  return parsed.success && parsed.data === userId;
}

// Next renders the page an action redirects to in an inner request whose Set-Cookie it drops, so the welcome screen
// renders with the cookie and the next request that carries it (the prefetch of a tile, a reload, log-out) removes it
// from the browser: the screen is seen once. A raw header and not response.cookies, which would also take the cookie
// away from the render of the request itself.
export function consumeWelcome(request: NextRequest, response: NextResponse): void {
  if (request.cookies.has(NAME)) response.headers.append("set-cookie", `${NAME}=; Path=/; Max-Age=0`);
}
