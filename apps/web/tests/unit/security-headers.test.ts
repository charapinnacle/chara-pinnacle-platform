import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

async function headersFor(source: string) {
  const rules = (await nextConfig.headers?.()) ?? [];
  const rule = rules.find((candidate) => candidate.source === source);
  return Object.fromEntries(
    (rule?.headers ?? []).map(({ key, value }) => [key, value]),
  );
}

describe("security headers", () => {
  it("applies to every path", async () => {
    expect(Object.keys(await headersFor("/:path*"))).not.toHaveLength(0);
  });

  it("sets HSTS with preload for two years", async () => {
    expect((await headersFor("/:path*"))["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("sets nosniff, framing, referrer and permissions policies", async () => {
    const headers = await headersFor("/:path*");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });

  it("leaves the CSP to proxy.ts because it needs a per-request nonce", async () => {
    expect(await headersFor("/:path*")).not.toHaveProperty(
      "Content-Security-Policy",
    );
  });

  it("no longer redirects the root in configuration", () => {
    expect(nextConfig.redirects).toBeUndefined();
  });
});
