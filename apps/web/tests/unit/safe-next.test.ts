import { describe, expect, it } from "vitest";
import { consentReturnPath, safeNextPath } from "@/lib/safe-next";

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
