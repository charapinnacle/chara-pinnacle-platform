import { describe, expect, it } from "vitest";
import { countryFromAcceptLanguage, localeRedirectPath } from "@/lib/i18n/locale";

describe("localeRedirectPath", () => {
  it("sends the root to the locale root", () => {
    expect(localeRedirectPath("/")).toBe("/en");
  });

  it("prefixes paths that have no locale", () => {
    expect(localeRedirectPath("/jobs")).toBe("/en/jobs");
    expect(localeRedirectPath("/legal/terms")).toBe("/en/legal/terms");
  });

  it("leaves paths that already carry a supported locale", () => {
    expect(localeRedirectPath("/en")).toBeNull();
    expect(localeRedirectPath("/en/jobs")).toBeNull();
  });

  it("leaves auth and api routes unprefixed", () => {
    expect(localeRedirectPath("/auth/callback")).toBeNull();
    expect(localeRedirectPath("/api/health")).toBeNull();
  });

  it("does not treat a path that only starts with an exempt word as exempt", () => {
    expect(localeRedirectPath("/authors")).toBe("/en/authors");
    expect(localeRedirectPath("/english")).toBe("/en/english");
  });

  it("prefixes an unsupported locale instead of trusting it", () => {
    expect(localeRedirectPath("/fr/jobs")).toBe("/en/fr/jobs");
  });
});

describe("countryFromAcceptLanguage", () => {
  const codes = ["AT", "DE", "FR", "GB", "TW", "US"];

  it("takes the region of the first language that names a country of the list", () => {
    expect(countryFromAcceptLanguage("de-DE,de;q=0.9,en;q=0.8", codes)).toBe("DE");
    expect(countryFromAcceptLanguage("en-GB", codes)).toBe("GB");
    expect(countryFromAcceptLanguage("de-at", codes)).toBe("AT");
    expect(countryFromAcceptLanguage("zh-Hant-TW", codes)).toBe("TW");
  });

  it("follows the quality values rather than the order, and skips a language the person refuses", () => {
    expect(countryFromAcceptLanguage("fr-FR;q=0.5, de-DE;q=0.9", codes)).toBe("DE");
    expect(countryFromAcceptLanguage("de-DE;q=0, fr-FR;q=0.4", codes)).toBe("FR");
  });

  it("goes on to the next language when a region is not in the list or is not a country", () => {
    expect(countryFromAcceptLanguage("es-419,es-XX,fr-FR", codes)).toBe("FR");
    expect(countryFromAcceptLanguage("en-ZZ, en-US", codes)).toBe("US");
  });

  it("chooses nothing for a language without a region, a wildcard or no header", () => {
    expect(countryFromAcceptLanguage("de", codes)).toBe("");
    expect(countryFromAcceptLanguage("*", codes)).toBe("");
    expect(countryFromAcceptLanguage("", codes)).toBe("");
    expect(countryFromAcceptLanguage(null, codes)).toBe("");
  });
});
