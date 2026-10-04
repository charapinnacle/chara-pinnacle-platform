import { describe, expect, it } from "vitest";
import { fieldErrors } from "@/lib/validation/sign-up";
import {
  enrolmentStartSchema,
  challengeSchema,
  codeInputSchema,
} from "@/lib/validation/mfa";

const CODE_MESSAGE = "Enter the 6-digit code from your authenticator app.";
const factorId = "3f2b6f0e-7a3c-4d57-9d5e-0a2f6a1d9c11";

function codeError(code: unknown): string | undefined {
  const result = challengeSchema.safeParse({ code });
  return result.success ? undefined : fieldErrors(result.error).code;
}

describe("the authentication code", () => {
  it.each(["000000", "123456", "007890"])("accepts %j", (code) => {
    expect(challengeSchema.parse({ code }).code).toBe(code);
  });

  it("accepts the code as authenticator apps show it, in two groups, and strips the space", () => {
    expect(challengeSchema.parse({ code: "123 456" }).code).toBe("123456");
    expect(challengeSchema.parse({ code: " 123456\n" }).code).toBe("123456");
  });

  it.each(["", "12345", "1234567", "12a456", "12-456", "１２３４５６", "123 45", "1e5678", null, undefined, 123456])(
    "refuses %j",
    (code) => {
      expect(codeError(code)).toBe(CODE_MESSAGE);
    },
  );
});

describe("the device name", () => {
  it("is trimmed and holds 1 to 32 characters", () => {
    expect(enrolmentStartSchema.parse({ name: "  Backup phone " }).name).toBe("Backup phone");
    expect(enrolmentStartSchema.parse({ name: "x".repeat(32) }).name).toHaveLength(32);
  });

  it.each([
    ["", "Enter a name for this device."],
    ["   ", "Enter a name for this device."],
    ["x".repeat(33), "The name must be 32 characters or fewer."],
  ])("refuses %j", (name, message) => {
    const result = enrolmentStartSchema.safeParse({ name });
    expect(result.success ? undefined : fieldErrors(result.error).name).toBe(message);
  });
});

describe("the action inputs", () => {
  it("keeps next as typed for the server to validate and drops one that is not a string", () => {
    expect(codeInputSchema.parse({ code: "123456", factorId, next: "/en/admin" }).next).toBe("/en/admin");
    expect(codeInputSchema.parse({ code: "123456", factorId, next: 42 }).next).toBeUndefined();
  });

  it("needs a factor id that is a UUID", () => {
    expect(codeInputSchema.safeParse({ code: "123456", factorId }).success).toBe(true);
    expect(codeInputSchema.safeParse({ code: "123456", factorId: "../x" }).success).toBe(false);
  });
});
