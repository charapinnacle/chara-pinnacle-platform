import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const challengeAndVerifyMock = vi.fn();
const userMock = vi.hoisted(() => vi.fn());
const startMock = vi.hoisted(() => vi.fn());
const verifyAnyMock = vi.hoisted(() => vi.fn());
const errorLogMock = vi.spyOn(console, "error").mockImplementation(() => {});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: userMock }));
vi.mock("@/lib/dal/mfa", () => ({ startEnrolment: startMock, verifyAnyTotp: verifyAnyMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { mfa: { challengeAndVerify: challengeAndVerifyMock } } }),
}));

const { answerChallenge, startBackupEnrolment, verifyEnrolment } = await import("@/lib/actions/mfa");

const factorId = "3f2b6f0e-7a3c-4d57-9d5e-0a2f6a1d9c11";
const WRONG = "That code is incorrect or has expired. Try again.";

beforeEach(() => {
  vi.clearAllMocks();
  userMock.mockResolvedValue({ id: "user-1", aal: "aal1", accountKind: "company" });
  challengeAndVerifyMock.mockResolvedValue({ data: {}, error: null });
  verifyAnyMock.mockResolvedValue(true);
});

describe("answerChallenge", () => {
  it("sends the user to the page asked for after a valid code", async () => {
    await expect(answerChallenge({ code: "123456", next: "/en/org/acme-bau/members" })).rejects.toThrow(
      "REDIRECT:/en/org/acme-bau/members",
    );
    expect(verifyAnyMock).toHaveBeenCalledWith(expect.anything(), "123456");
  });

  it("sends the user to the dashboard of their kind when no page was asked for", async () => {
    await expect(answerChallenge({ code: "123 456" })).rejects.toThrow("REDIRECT:/en/dashboard/employer");
    expect(verifyAnyMock).toHaveBeenCalledWith(expect.anything(), "123456");
  });

  it.each(["https://evil.example", "//evil.example", "/en/mfa", "javascript:alert(1)"])(
    "does not return to %j",
    async (next) => {
      await expect(answerChallenge({ code: "123456", next })).rejects.toThrow(
        "REDIRECT:/en/dashboard/employer",
      );
    },
  );

  it("answers a wrong code with the message on the code field and does not redirect", async () => {
    verifyAnyMock.mockResolvedValue(false);
    expect(await answerChallenge({ code: "000000" })).toEqual({ errors: { code: WRONG } });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it.each(["12345", "12a456", "1234567", ""])("refuses %j without calling Auth", async (code) => {
    expect(await answerChallenge({ code })).toEqual({
      errors: { code: "Enter the 6-digit code from your authenticator app." },
    });
    expect(verifyAnyMock).not.toHaveBeenCalled();
  });

  it("needs a signed-in user", async () => {
    userMock.mockRejectedValue(new Error("REDIRECT:/en/login"));
    await expect(answerChallenge({ code: "123456" })).rejects.toThrow("REDIRECT:/en/login");
    expect(verifyAnyMock).not.toHaveBeenCalled();
  });
});

describe("verifyEnrolment", () => {
  it("verifies the factor and sends a user at aal1 to the page asked for", async () => {
    await expect(verifyEnrolment({ factorId, code: "123456", next: "/en/admin" })).rejects.toThrow(
      "REDIRECT:/en/admin",
    );
    expect(challengeAndVerifyMock).toHaveBeenCalledWith({ factorId, code: "123456" });
  });

  it("keeps a user at aal2 on the page, because a backup device was added", async () => {
    userMock.mockResolvedValue({ id: "user-1", aal: "aal2", accountKind: "company" });
    expect(await verifyEnrolment({ factorId, code: "123456" })).toEqual({ added: true });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it.each(["mfa_verification_failed", "mfa_challenge_expired"])(
    "answers the Auth refusal %s as a wrong code",
    async (code) => {
      challengeAndVerifyMock.mockResolvedValue({ data: null, error: new AuthApiError("no", 422, code) });
      expect(await verifyEnrolment({ factorId, code: "000000" })).toEqual({ errors: { code: WRONG } });
      expect(redirectMock).not.toHaveBeenCalled();
    },
  );

  it("tells the user to start again when another tab replaced the enrolment", async () => {
    challengeAndVerifyMock.mockResolvedValue({
      data: null,
      error: new AuthApiError("gone", 404, "mfa_factor_not_found"),
    });
    expect(await verifyEnrolment({ factorId, code: "123456" })).toEqual({
      message: "This setup is no longer valid. Reload the page to start again.",
    });
  });

  it("reports a rate limit and hides any other Auth failure behind a generic message, logging the code only", async () => {
    challengeAndVerifyMock.mockResolvedValue({
      data: null,
      error: new AuthApiError("slow down", 429, "over_request_rate_limit"),
    });
    expect(await verifyEnrolment({ factorId, code: "123456" })).toEqual({
      message: "Too many attempts. Try again in a few minutes.",
    });
    challengeAndVerifyMock.mockResolvedValue({
      data: null,
      error: new AuthApiError("db password leaked here", 500, "unexpected_failure"),
    });
    expect(await verifyEnrolment({ factorId, code: "123456" })).toEqual({
      message: "We could not complete this request. Try again.",
    });
    expect(errorLogMock).toHaveBeenCalledWith("Two-step verification failed", {
      code: "unexpected_failure",
      status: 500,
    });
  });

  it.each([
    ["a malformed code", { factorId, code: "12345" }],
    ["a factor id that is not a UUID", { factorId: "../x", code: "123456" }],
  ])("refuses %s without calling Auth", async (_name, input) => {
    const result = await verifyEnrolment(input);
    expect(result?.errors).toBeDefined();
    expect(challengeAndVerifyMock).not.toHaveBeenCalled();
  });
});

describe("startBackupEnrolment", () => {
  const enrolment = { factorId, qrCode: "data:image/svg+xml;utf-8,<svg/>", secret: "JBSWY3DPEHPK3PXP" };

  it("returns the enrolment for a valid name, trimmed", async () => {
    startMock.mockResolvedValue(enrolment);
    expect(await startBackupEnrolment({ name: "  Backup phone " })).toEqual({ enrolment });
    expect(startMock).toHaveBeenCalledWith("en", "Backup phone");
  });

  it("answers a name that is already used as a field error", async () => {
    startMock.mockResolvedValue({ refused: "name_taken" });
    expect(await startBackupEnrolment({ name: "Authenticator" })).toEqual({
      errors: { name: "You already use this name for another device." },
    });
  });

  it("refuses a third device with the limit message", async () => {
    startMock.mockResolvedValue({ refused: "too_many" });
    expect(await startBackupEnrolment({ name: "Third" })).toEqual({
      message: "You can register at most two authenticator devices.",
    });
  });

  it.each(["", "   ", "x".repeat(33)])("refuses the name %j without asking Auth", async (name) => {
    const result = await startBackupEnrolment({ name });
    expect(result.errors?.name).toBeDefined();
    expect(startMock).not.toHaveBeenCalled();
  });
});
