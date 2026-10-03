import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

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
