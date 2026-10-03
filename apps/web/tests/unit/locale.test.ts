import { describe, expect, it } from "vitest";
import { localeRedirectPath } from "@/lib/i18n/locale";

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
