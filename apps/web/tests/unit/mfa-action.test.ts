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
const verifyTotpMock = vi.hoisted(() => vi.fn());
const listFactorsMock = vi.hoisted(() => vi.fn());
const throttledMock = vi.hoisted(() => vi.fn());
const errorLogMock = vi.spyOn(console, "error").mockImplementation(() => {});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: userMock }));
vi.mock("@/lib/dal/mfa", () => ({
  startEnrolment: startMock,
  verifyTotp: verifyTotpMock,
  listVerifiedFactors: listFactorsMock,
  hasVerifiedTotpFactor: async () => (await listFactorsMock()).length > 0,
}));
vi.mock("@/lib/dal/rate-limit", () => ({ isThrottled: throttledMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { mfa: { challengeAndVerify: challengeAndVerifyMock } } }),
}));

const { answerChallenge, startFactorEnrolment, verifyEnrolment } = await import("@/lib/actions/mfa");

const factorId = "3f2b6f0e-7a3c-4d57-9d5e-0a2f6a1d9c11";
const otherFactorId = "9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const WRONG = "That code is incorrect or has expired. Try again.";
const THROTTLED = "Too many attempts. Try again in a few minutes.";
const AAL2_FIRST = "Enter a code from your authenticator app first, then change your devices.";
const verified = (id: string) => ({ id, name: "Authenticator", createdAt: "2026-10-04T10:00:00Z" });

beforeEach(() => {
  vi.clearAllMocks();
  userMock.mockResolvedValue({ id: "user-1", aal: "aal1", accountKind: "company" });
  challengeAndVerifyMock.mockResolvedValue({ data: {}, error: null });
  verifyTotpMock.mockResolvedValue(null);
  listFactorsMock.mockResolvedValue([verified(factorId)]);
  throttledMock.mockResolvedValue(false);
});

describe("answerChallenge", () => {
  it("sends the user to the page asked for after a valid code, checking the chosen factor only", async () => {
    await expect(
      answerChallenge({ factorId, code: "123456", next: "/en/org/acme-bau/members" }),
    ).rejects.toThrow("REDIRECT:/en/org/acme-bau/members");
    expect(verifyTotpMock).toHaveBeenCalledTimes(1);
    expect(verifyTotpMock).toHaveBeenCalledWith(expect.anything(), factorId, "123456");
  });

  it("sends the user to the dashboard of their kind when no page was asked for", async () => {
    await expect(answerChallenge({ factorId, code: "123 456" })).rejects.toThrow("REDIRECT:/en/dashboard/employer");
    expect(verifyTotpMock).toHaveBeenCalledWith(expect.anything(), factorId, "123456");
  });

  it.each(["https://evil.example", "//evil.example", "/en/mfa", "javascript:alert(1)"])(
    "does not return to %j",
    async (next) => {
      await expect(answerChallenge({ factorId, code: "123456", next })).rejects.toThrow(
        "REDIRECT:/en/dashboard/employer",
      );
    },
  );

  it("answers a wrong code with the message on the code field and does not redirect", async () => {
    verifyTotpMock.mockResolvedValue(new AuthApiError("no", 422, "mfa_verification_failed"));
    expect(await answerChallenge({ factorId, code: "000000" })).toEqual({ errors: { code: WRONG } });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("does not call a rate limit of Auth a wrong code", async () => {
    verifyTotpMock.mockResolvedValue(new AuthApiError("slow down", 429, "over_request_rate_limit"));
    expect(await answerChallenge({ factorId, code: "123456" })).toEqual({ message: THROTTLED });
  });

  it("hides any other Auth failure behind a generic message and logs the code only", async () => {
    verifyTotpMock.mockResolvedValue(new AuthApiError("db password leaked here", 500, "unexpected_failure"));
    expect(await answerChallenge({ factorId, code: "123456" })).toEqual({
      message: "We could not complete this request. Try again.",
    });
    expect(errorLogMock).toHaveBeenCalledWith("Two-step verification failed", { code: "unexpected_failure", status: 500 });
  });

  it("does not reach Auth when the visitor is over the limit", async () => {
    throttledMock.mockResolvedValue(true);
    expect(await answerChallenge({ factorId, code: "123456" })).toEqual({ message: THROTTLED });
    expect(throttledMock).toHaveBeenCalledWith("mfa_code");
    expect(verifyTotpMock).not.toHaveBeenCalled();
    expect(listFactorsMock).not.toHaveBeenCalled();
  });

  it("refuses a factor that is not one of the verified factors of the user", async () => {
    expect(await answerChallenge({ factorId: otherFactorId, code: "123456" })).toEqual({
      message: "This setup is no longer valid. Reload the page to start again.",
    });
    expect(verifyTotpMock).not.toHaveBeenCalled();
  });

  it.each(["12345", "12a456", "1234567", ""])("refuses %j without calling Auth or counting an attempt", async (code) => {
    expect(await answerChallenge({ factorId, code })).toEqual({
      errors: { code: "Enter the 6-digit code from your authenticator app." },
    });
    expect(verifyTotpMock).not.toHaveBeenCalled();
    expect(throttledMock).not.toHaveBeenCalled();
  });

  it("needs a signed-in user", async () => {
    userMock.mockRejectedValue(new Error("REDIRECT:/en/login"));
    await expect(answerChallenge({ factorId, code: "123456" })).rejects.toThrow("REDIRECT:/en/login");
    expect(verifyTotpMock).not.toHaveBeenCalled();
  });
});

describe("verifyEnrolment", () => {
  beforeEach(() => {
    listFactorsMock.mockResolvedValue([]);
  });

  it("verifies the factor and sends a user at aal1 to the page asked for", async () => {
    await expect(verifyEnrolment({ factorId, code: "123456", next: "/en/admin" })).rejects.toThrow(
      "REDIRECT:/en/admin",
    );
    expect(challengeAndVerifyMock).toHaveBeenCalledWith({ factorId, code: "123456" });
  });

  it("does not let a session at aal1 verify a factor when a verified factor exists, and never asks Auth", async () => {
    listFactorsMock.mockResolvedValue([verified(otherFactorId)]);
    expect(await verifyEnrolment({ factorId, code: "123456" })).toEqual({ message: AAL2_FIRST });
    expect(challengeAndVerifyMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("does not reach Auth when the visitor is over the limit", async () => {
    throttledMock.mockResolvedValue(true);
    expect(await verifyEnrolment({ factorId, code: "123456" })).toEqual({ message: THROTTLED });
    expect(throttledMock).toHaveBeenCalledWith("mfa_code");
    expect(challengeAndVerifyMock).not.toHaveBeenCalled();
  });

  it("keeps a user at aal2 on the page, because a backup device was added", async () => {
    listFactorsMock.mockResolvedValue([verified(otherFactorId)]);
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

describe("startFactorEnrolment", () => {
  const enrolment = { factorId, qrCode: "data:image/svg+xml;utf-8,<svg/>", secret: "JBSWY3DPEHPK3PXP" };

  it("returns the enrolment for a valid name, trimmed, and passes the session level on", async () => {
    startMock.mockResolvedValue(enrolment);
    expect(await startFactorEnrolment({ name: "  Backup phone " })).toEqual({ enrolment });
    expect(startMock).toHaveBeenCalledWith("en", "Backup phone", "aal1");
  });

  it("answers a name that is already used as a field error", async () => {
    startMock.mockResolvedValue({ refused: "name_taken" });
    expect(await startFactorEnrolment({ name: "Authenticator" })).toEqual({
      errors: { name: "You already use this name for another device." },
    });
  });

  it("refuses a third device with the limit message", async () => {
    startMock.mockResolvedValue({ refused: "too_many" });
    expect(await startFactorEnrolment({ name: "Third" })).toEqual({
      message: "You can register at most two authenticator devices.",
    });
  });

  it("answers a session at aal1 that already has a verified factor with a refusal, not an error", async () => {
    startMock.mockResolvedValue({ refused: "aal2_required" });
    expect(await startFactorEnrolment({ name: "Backup" })).toEqual({ message: AAL2_FIRST });
  });

  it.each(["", "   ", "x".repeat(33)])("refuses the name %j without asking Auth", async (name) => {
    const result = await startFactorEnrolment({ name });
    expect(result.errors?.name).toBeDefined();
    expect(startMock).not.toHaveBeenCalled();
  });
});
