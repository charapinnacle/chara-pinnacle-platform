import { describe, expect, it, vi } from "vitest";
import { googleSignInEnabled, parseEnv } from "@/lib/env";
import { parseServerEnv } from "@/lib/env.server";

vi.mock("server-only", () => ({}));

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
  NEXT_PUBLIC_SITE_URL: "https://chara.example/",
};

describe("parseEnv", () => {
  it("accepts a complete configuration and normalises the site URL to its origin", () => {
    expect(parseEnv(valid)).toEqual({
      ...valid,
      NEXT_PUBLIC_SITE_URL: "https://chara.example",
    });
  });

  it("names every missing variable and nothing else", () => {
    expect(() => parseEnv({})).toThrowError(
      "Invalid environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SITE_URL",
    );
  });

  it("rejects a Supabase URL that is not http or https", () => {
    expect(() =>
      parseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "ftp://abc.supabase.co" }),
    ).toThrowError("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("rejects a key that is not a publishable key", () => {
    expect(() =>
      parseEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          "eyJhbGciOiJIUzI1NiJ9.payload.sig",
      }),
    ).toThrowError("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });

  it("does not echo the offending value in the error", () => {
    expect(() =>
      parseEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "leaky-value",
      }),
    ).not.toThrowError(/leaky-value/);
  });
});

describe("parseServerEnv", () => {
  const server = {
    VISITOR_HASH_SECRET: "a-secret-of-at-least-32-characters-0123",
    TRUSTED_PROXY_HOPS: "1",
  };

  it("accepts a secret and a hop count and reads the hops as a number", () => {
    expect(parseServerEnv(server)).toEqual({ ...server, TRUSTED_PROXY_HOPS: 1 });
  });

  it("reads the address of the document-url function when one is given, and only a web address", () => {
    expect(parseServerEnv({ ...server, DOCUMENT_URL_ENDPOINT: "http://127.0.0.1:54432/" }).DOCUMENT_URL_ENDPOINT).toBe("http://127.0.0.1:54432/");
    expect(parseServerEnv(server).DOCUMENT_URL_ENDPOINT).toBeUndefined();
    expect(() => parseServerEnv({ ...server, DOCUMENT_URL_ENDPOINT: "ftp://example.com/" })).toThrowError("DOCUMENT_URL_ENDPOINT");
  });

  it("reads the address of the billing-checkout function when one is given, and only a web address", () => {
    expect(parseServerEnv({ ...server, BILLING_CHECKOUT_ENDPOINT: "http://127.0.0.1:54434/" }).BILLING_CHECKOUT_ENDPOINT).toBe("http://127.0.0.1:54434/");
    expect(parseServerEnv(server).BILLING_CHECKOUT_ENDPOINT).toBeUndefined();
    expect(() => parseServerEnv({ ...server, BILLING_CHECKOUT_ENDPOINT: "ftp://example.com/" })).toThrowError("BILLING_CHECKOUT_ENDPOINT");
  });

  it("names a missing secret and a missing hop count", () => {
    expect(() => parseServerEnv({})).toThrowError(
      "Invalid environment variables: VISITOR_HASH_SECRET, TRUSTED_PROXY_HOPS",
    );
  });

  it("rejects a short secret without echoing it", () => {
    const attempt = () => parseServerEnv({ ...server, VISITOR_HASH_SECRET: "too-short" });
    expect(attempt).toThrowError("VISITOR_HASH_SECRET");
    expect(attempt).not.toThrowError(/too-short/);
  });

  it.each(["0", "-1", "1.5", "11", "many", ""])("rejects %j as a number of trusted proxies", (hops) => {
    expect(() => parseServerEnv({ ...server, TRUSTED_PROXY_HOPS: hops })).toThrowError("TRUSTED_PROXY_HOPS");
  });
});

describe("googleSignInEnabled", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["false", false],
    ["true", true],
    ["TRUE", false],
    ["1", false],
    ["yes", false],
  ])("reads %j as %j", (value, expected) => {
    vi.stubEnv("GOOGLE_SIGN_IN_ENABLED", value);
    expect(googleSignInEnabled()).toBe(expected);
    vi.unstubAllEnvs();
  });
});
