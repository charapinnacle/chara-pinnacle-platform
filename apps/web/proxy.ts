import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";
import { env } from "@/lib/env";
import { localeRedirectPath } from "@/lib/i18n/locale";
import { signedInLoginTarget } from "@/lib/safe-next";
import { isPrivatePath } from "@/lib/seo/private-routes";
import { updateSession } from "@/lib/supabase/proxy";
import { consumeWelcome } from "@/lib/welcome-cookie";

export async function proxy(request: NextRequest) {
  const redirectPath = localeRedirectPath(request.nextUrl.pathname);
  if (redirectPath) {
    const url = request.nextUrl.clone();
    url.pathname = redirectPath;
    const redirect = NextResponse.redirect(url);
    if (isPrivatePath(redirectPath)) redirect.headers.set("x-robots-tag", "noindex, nofollow");
    return redirect;
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
  requestHeaders.set(
    "x-pathname",
    request.nextUrl.pathname + request.nextUrl.search,
  );
  requestHeaders.set("content-security-policy", csp);

  const { response, supabase, userId } = await updateSession(request, requestHeaders);
  // A signed-in person who opens the login page goes on at once, with a real redirect: the page itself renders inside the
  // loading boundary of (auth), where a redirect comes after the 200 has been sent. A sign-in error is still shown.
  const login = /^\/([^/]+)\/login\/?$/.exec(request.nextUrl.pathname);
  if (login && userId && !request.nextUrl.searchParams.has("error")) {
    const { data: profile } = await supabase.from("profiles").select("account_kind, status").eq("id", userId).maybeSingle();
    if (profile && profile.status !== "suspended") {
      const { data: membership } =
        profile.account_kind === "company"
          ? await supabase
              .from("organization_members")
              .select("organizations(slug, type)")
              .eq("user_id", userId)
              .not("accepted_at", "is", null)
              .order("accepted_at")
              .limit(1)
              .maybeSingle()
          : { data: null };
      const target = signedInLoginTarget(
        login[1],
        request.nextUrl.searchParams.get("next"),
        profile.account_kind,
        membership?.organizations,
      );
      const redirect = NextResponse.redirect(new URL(target, request.url));
      response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      redirect.headers.set("x-robots-tag", "noindex, nofollow");
      return redirect;
    }
  }
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-request-id", requestId);
  if (isPrivatePath(request.nextUrl.pathname)) response.headers.set("x-robots-tag", "noindex, nofollow");
  consumeWelcome(request, response);
  return response;
}

// Server Functions are POSTs to the page route: excluding a path here would
// also remove the CSP and session refresh for its actions (ADR-0004).
// api/health and api/cities answer the same JSON to everyone: they need no session, and a refreshed session cookie on
// the city suggestions would keep the CDN from caching them.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|opengraph-image|api/health|api/cities|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
