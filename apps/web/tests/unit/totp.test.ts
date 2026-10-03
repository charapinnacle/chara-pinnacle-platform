import { describe, expect, it } from "vitest";
import { totpCode } from "../e2e/support/totp";

// RFC 6238 appendix B (SHA-1, secret "12345678901234567890"), last six digits.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totpCode", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("matches the RFC 6238 vector at %i s", (seconds, code) => {
    expect(totpCode(RFC_SECRET, seconds * 1000)).toBe(code);
  });

  it("keeps the code for the whole 30 second step and changes at the next", () => {
    expect(totpCode(RFC_SECRET, 30_000)).toBe(totpCode(RFC_SECRET, 59_999));
    expect(totpCode(RFC_SECRET, 59_999)).not.toBe(totpCode(RFC_SECRET, 60_000));
  });

  it("accepts lowercase, spaced and padded secrets", () => {
    expect(
      totpCode(RFC_SECRET.toLowerCase().replace(/(.{8})/g, "$1 "), 59_000),
    ).toBe("287082");
  });

  it("rejects a secret that is not base32", () => {
    expect(() => totpCode("not-base32!")).toThrow("not valid base32");
  });
});
