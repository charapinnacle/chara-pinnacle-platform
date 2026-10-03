import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../../proxy";

const origin = "http://localhost:3100";
const supabase = "http://127.0.0.1:54421";

function base64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

const accessToken = [
  base64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  base64url(JSON.stringify({ sub: "user-1", exp: 4102444800 })),
  "signature",
].join(".");

function session(overrides: Record<string, unknown>) {
  return {
    access_token: accessToken,
    refresh_token: "refresh-old",
    token_type: "bearer",
    expires_in: 3600,
    user: { id: "user-1", aud: "authenticated", app_metadata: {} },
    ...overrides,
  };
}

function sessionCookie(value: Record<string, unknown>) {
  return `sb-127-auth-token=base64-${base64url(JSON.stringify(value))}`;
}

function stubSupabase() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("grant_type=refresh_token")) {
      return Response.json(session({ refresh_token: "refresh-new" }));
    }
    if (url.endsWith("/auth/v1/user")) {
      return Response.json(session({}).user);
    }
    return Response.json({ keys: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("proxy session refresh", () => {
  it("rotates an expired session and keeps the CSP and nonce on the response", async () => {
    const fetchMock = stubSupabase();
    const expired = session({ expires_at: 1 });
    const response = await proxy(
      new NextRequest(`${origin}/en`, {
        headers: { cookie: sessionCookie(expired) },
      }),
    );

    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith(`${supabase}/auth/v1/token?grant_type=refresh_token`),
      ),
    ).toBe(true);
    const setCookie = response.headers.getSetCookie().join("\n");
    expect(setCookie).toContain("sb-127-auth-token=");
    expect(
      Buffer.from(
        /sb-127-auth-token=base64-([^;]+)/.exec(setCookie)?.[1] ?? "",
        "base64url",
      ).toString(),
    ).toContain("refresh-new");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("does not call Supabase or set cookies for an anonymous request", async () => {
    const fetchMock = stubSupabase();
    const response = await proxy(new NextRequest(`${origin}/en`));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });
});
