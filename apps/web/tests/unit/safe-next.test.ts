import { describe, expect, it } from "vitest";
import { consentReturnPath, mfaReturnPath, safeNextPath, signedInLoginTarget } from "@/lib/safe-next";

describe("safeNextPath", () => {
  it.each([
    ["/en/dashboard", "/en/dashboard"],
    ["/en/jobs?q=nurse&page=2", "/en/jobs?q=nurse&page=2"],
    ["/en/passport#documents", "/en/passport#documents"],
    ["/a/../en/x", "/en/x"],
  ])("keeps the local path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["an absolute URL", "https://evil.example/"],
    ["a protocol-relative URL", "//evil.example"],
    ["a protocol-relative URL with a backslash", "/\\evil.example"],
    ["a backslash-first URL", "\\\\evil.example"],
    ["a tab inside the slashes", "/\t/evil.example"],
    ["a newline inside the slashes", "/\n/evil.example"],
    ["a javascript scheme", "javascript:alert(1)"],
    ["a relative path", "en/dashboard"],
    ["dot segments that collapse into two slashes", "/a/..//evil.example"],
    ["a control character", "/en/\u0000x"],
    ["an empty string", ""],
  ])("falls back for %s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it("falls back for a missing value", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });
});

describe("consentReturnPath", () => {
  it("returns to the page the user asked for", () => {
    expect(consentReturnPath("en", "/en/onboarding?x=1")).toBe("/en/onboarding?x=1");
  });

  it.each([
    ["an external URL", "https://evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["the consent page itself", "/en/consent?next=/en/consent"],
    ["nothing", ""],
  ])("lands on onboarding for %s", (_label, next) => {
    expect(consentReturnPath("en", next)).toBe("/en/onboarding");
  });
});

describe("mfaReturnPath", () => {
  const home = "/en/dashboard/employer";

  it("returns to the page asked for", () => {
    expect(mfaReturnPath("en", "/en/org/acme-bau/members?x=1", home)).toBe("/en/org/acme-bau/members?x=1");
  });

  it.each([undefined, null, "", "/", "https://evil.example", "//evil.example", "/\\evil.example"])(
    "falls back for the missing or unsafe value %j",
    (next) => {
      expect(mfaReturnPath("en", next, home)).toBe(home);
    },
  );

  it("never returns to the MFA page itself, so a verified user cannot loop", () => {
    expect(mfaReturnPath("en", "/en/mfa", home)).toBe(home);
    expect(mfaReturnPath("en", "/en/mfa?next=/en/mfa", home)).toBe(home);
  });
});

describe("signedInLoginTarget", () => {
  it("sends a signed-in person from the login page to the page asked for, else to their home", () => {
    expect(signedInLoginTarget("en", "/en/org/acme/jobs?x=1", "company")).toBe("/en/org/acme/jobs?x=1");
    expect(signedInLoginTarget("en", null, "worker")).toBe("/en/dashboard/worker");
    expect(signedInLoginTarget("en", undefined, "company")).toBe("/en/dashboard/employer");
    expect(signedInLoginTarget("en", null, null)).toBe("/en/onboarding");
    expect(signedInLoginTarget("en", "//evil.example", "worker")).toBe("/en/dashboard/worker");
    expect(signedInLoginTarget("en", "/en/login?next=/en/jobs", "worker")).toBe("/en/dashboard/worker");
  });
});
