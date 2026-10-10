import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "../../proxy";

const origin = "http://localhost:3100";

function matches(url: string) {
  return unstable_doesMiddlewareMatch({ config, url });
}

describe("proxy matcher", () => {
  it.each(["/en", "/en/jobs", "/jobs", "/auth/callback", "/en/apply.json"])(
    "runs for %s",
    (url) => {
      expect(matches(url)).toBe(true);
    },
  );

  it.each([
    "/_next/static/chunk.js",
    "/_next/image",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
    "/api/health",
    "/logo.svg",
  ])("skips %s", (url) => {
    expect(matches(url)).toBe(false);
  });
});

describe("proxy", () => {
  it("redirects a path without a locale and keeps the query string", async () => {
    const response = await proxy(new NextRequest(`${origin}/jobs?q=nurse`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${origin}/en/jobs?q=nurse`);
  });

  it("redirects the root to the locale root", async () => {
    const response = await proxy(new NextRequest(`${origin}/`));
    expect(response.headers.get("location")).toBe(`${origin}/en`);
  });

  it("FR-H5 AC7: marks the language redirect of a private path noindex, and that of a public path not", async () => {
    for (const path of ["/dashboard", "/login", "/org/acme/jobs"]) {
      const response = await proxy(new NextRequest(`${origin}${path}`));
      expect(response.status, path).toBe(307);
      expect(response.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
    }
    for (const path of ["/", "/jobs", "/pricing"]) {
      const response = await proxy(new NextRequest(`${origin}${path}`));
      expect(response.status, path).toBe(307);
      expect(response.headers.get("x-robots-tag"), path).toBeNull();
    }
  });

  it("sets a nonce CSP on the response and passes the same one to the page", async () => {
    const response = await proxy(new NextRequest(`${origin}/en`));
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(
      response.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(csp);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it("FR-H5 AC7: marks the answer for a private page noindex and leaves the public pages alone", async () => {
    for (const path of ["/en/dashboard/worker", "/en/org/acme/jobs", "/en/login", "/en/mfa", "/auth/callback"]) {
      const response = await proxy(new NextRequest(`${origin}${path}`));
      expect(response.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
    }
    for (const path of ["/en", "/en/jobs", "/en/jobs/6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11", "/en/pricing", "/en/legal/privacy-policy"]) {
      const response = await proxy(new NextRequest(`${origin}${path}`));
      expect(response.headers.get("x-robots-tag"), path).toBeNull();
    }
  });

  it("uses a different nonce and request id on every request", async () => {
    const [a, b] = await Promise.all([
      proxy(new NextRequest(`${origin}/en`)),
      proxy(new NextRequest(`${origin}/en`)),
    ]);
    expect(a.headers.get("x-middleware-request-x-nonce")).not.toBe(
      b.headers.get("x-middleware-request-x-nonce"),
    );
    expect(a.headers.get("x-request-id")).not.toBe(
      b.headers.get("x-request-id"),
    );
  });

  it("passes the requested path and query on for the consent gate", async () => {
    const response = await proxy(
      new NextRequest(`${origin}/en/onboarding?step=1`),
    );
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe(
      "/en/onboarding?step=1",
    );
  });

  it("does not trust a path header sent by the client", async () => {
    const response = await proxy(
      new NextRequest(`${origin}/en/onboarding`, {
        headers: { "x-pathname": "//evil.example" },
      }),
    );
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe(
      "/en/onboarding",
    );
  });

  it("does not trust a nonce or CSP sent by the client", async () => {
    const response = await proxy(
      new NextRequest(`${origin}/en`, {
        headers: {
          "x-nonce": "forged",
          "content-security-policy": "default-src *",
        },
      }),
    );
    expect(response.headers.get("x-middleware-request-x-nonce")).not.toBe(
      "forged",
    );
    expect(response.headers.get("content-security-policy")).not.toContain("*");
  });

  it("serves auth routes without a locale redirect and with the CSP", async () => {
    const response = await proxy(new NextRequest(`${origin}/auth/callback`));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain("nonce-");
  });
});
