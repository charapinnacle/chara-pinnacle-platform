import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/csp";

const base = {
  nonce: "bm9uY2U=",
  supabaseUrl: "https://abc.supabase.co",
  isDev: false,
  upgradeInsecureRequests: true,
};

function directive(csp: string, name: string) {
  return csp
    .split("; ")
    .find((part) => part.startsWith(`${name} `) || part === name);
}

describe("buildCsp", () => {
  it("allows scripts only through the nonce and strict-dynamic", () => {
    expect(directive(buildCsp(base), "script-src")).toBe(
      "script-src 'self' 'nonce-bm9uY2U=' 'strict-dynamic'",
    );
  });

  it("never allows unsafe-inline", () => {
    expect(buildCsp(base)).not.toContain("'unsafe-inline'");
    expect(buildCsp({ ...base, isDev: true })).not.toContain("'unsafe-inline'");
  });

  it("allows unsafe-eval in development only", () => {
    expect(buildCsp(base)).not.toContain("'unsafe-eval'");
    expect(
      directive(buildCsp({ ...base, isDev: true }), "script-src"),
    ).toContain("'unsafe-eval'");
  });

  it("restricts framing, plugins, base URI and form targets", () => {
    const csp = buildCsp(base);
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
  });

  it("connects only to self and the Supabase host over https and wss", () => {
    expect(directive(buildCsp(base), "connect-src")).toBe(
      "connect-src 'self' https://abc.supabase.co wss://abc.supabase.co",
    );
  });

  it("uses ws with the port for the local stack", () => {
    expect(
      directive(
        buildCsp({ ...base, supabaseUrl: "http://127.0.0.1:54421" }),
        "connect-src",
      ),
    ).toBe("connect-src 'self' http://127.0.0.1:54421 ws://127.0.0.1:54421");
  });

  it("adds upgrade-insecure-requests only when asked", () => {
    expect(directive(buildCsp(base), "upgrade-insecure-requests")).toBe(
      "upgrade-insecure-requests",
    );
    expect(
      directive(
        buildCsp({ ...base, upgradeInsecureRequests: false }),
        "upgrade-insecure-requests",
      ),
    ).toBeUndefined();
  });
});
