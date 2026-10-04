import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/env");
  vi.resetModules();
});

async function sessionCookieOptions(siteUrl: string) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SITE_URL: siteUrl } }));
  return (await import("@/lib/supabase/cookie-options")).sessionCookieOptions;
}

const libraryDefaults = { path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 * 24 * 60 * 60 } as const;

describe("session cookie options", () => {
  it("replaces the library's 400-day lifetime with 7 days and keeps its other options", async () => {
    const options = (await sessionCookieOptions("http://localhost:3100"))(libraryDefaults);
    expect(options).toEqual({ ...libraryDefaults, maxAge: 604_800, secure: false });
  });

  it("keeps a removal a removal", async () => {
    const options = (await sessionCookieOptions("http://localhost:3100"))({
      ...libraryDefaults,
      maxAge: 0,
    });
    expect(options.maxAge).toBe(0);
  });

  it("marks the cookies Secure when the site is served over https and never HttpOnly", async () => {
    const options = (await sessionCookieOptions("https://chara.example"))(libraryDefaults);
    expect(options.secure).toBe(true);
    expect(options.httpOnly).toBe(false);
  });
});
