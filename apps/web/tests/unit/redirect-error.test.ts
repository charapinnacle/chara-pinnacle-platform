import { describe, expect, it } from "vitest";
import { isRedirectError } from "@/lib/redirect-error";

describe("isRedirectError", () => {
  it("recognises the error a redirecting Server Action rejects with", () => {
    const error = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;push;/en/verify-email;303;",
    });
    expect(isRedirectError(error)).toBe(true);
  });

  it.each([
    ["a plain error", new Error("boom")],
    ["a network failure", new TypeError("Failed to fetch")],
    ["another digest", Object.assign(new Error("x"), { digest: "NEXT_NOT_FOUND" })],
    ["a non-string digest", { digest: 1 }],
    ["null", null],
    ["a string", "NEXT_REDIRECT;"],
  ])("does not treat %s as a redirect", (_label, error) => {
    expect(isRedirectError(error)).toBe(false);
  });
});
