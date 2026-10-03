import { describe, expect, it } from "vitest";
import { localeRedirectPath, negotiateLocale } from "@/lib/i18n/locale";

describe("negotiateLocale", () => {
  it("falls back to English without a header", () => {
    expect(negotiateLocale(null)).toBe("en");
    expect(negotiateLocale("")).toBe("en");
  });

  it("matches a supported language through a regional tag", () => {
    expect(negotiateLocale("en-GB,en;q=0.8")).toBe("en");
  });

  it("falls back to English when no listed language is supported", () => {
    expect(negotiateLocale("fr-FR,de;q=0.7")).toBe("en");
  });

  it("ignores languages refused with q=0 and malformed weights", () => {
    expect(negotiateLocale("en;q=0")).toBe("en");
    expect(negotiateLocale("fr,en;q=abc")).toBe("en");
  });
});

describe("localeRedirectPath", () => {
  it("sends the root to the locale root", () => {
    expect(localeRedirectPath("/", null)).toBe("/en");
  });

  it("prefixes paths that have no locale", () => {
    expect(localeRedirectPath("/jobs", null)).toBe("/en/jobs");
    expect(localeRedirectPath("/legal/terms", "fr")).toBe("/en/legal/terms");
  });

  it("leaves paths that already carry a supported locale", () => {
    expect(localeRedirectPath("/en", null)).toBeNull();
    expect(localeRedirectPath("/en/jobs", null)).toBeNull();
  });

  it("leaves auth and api routes unprefixed", () => {
    expect(localeRedirectPath("/auth/callback", null)).toBeNull();
    expect(localeRedirectPath("/api/health", null)).toBeNull();
  });

  it("does not treat a path that only starts with an exempt word as exempt", () => {
    expect(localeRedirectPath("/authors", null)).toBe("/en/authors");
    expect(localeRedirectPath("/english", null)).toBe("/en/english");
  });

  it("prefixes an unsupported locale instead of trusting it", () => {
    expect(localeRedirectPath("/fr/jobs", null)).toBe("/en/fr/jobs");
  });
});
