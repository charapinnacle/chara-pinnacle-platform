import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";
import { env } from "@/lib/env";
import { localeRedirectPath } from "@/lib/i18n/locale";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const redirectPath = localeRedirectPath(request.nextUrl.pathname);
  if (redirectPath) {
    const url = request.nextUrl.clone();
    url.pathname = redirectPath;
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({
    nonce,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    isDev: process.env.NODE_ENV === "development",
    upgradeInsecureRequests: env.NEXT_PUBLIC_SITE_URL.startsWith("https:"),
  });
  const requestId = crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("content-security-policy", csp);

  const response = await updateSession(request, requestHeaders);
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-request-id", requestId);
  return response;
}

// Server Functions are POSTs to the page route: excluding a path here would
// also remove the CSP and session refresh for its actions (ADR-0004).
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
