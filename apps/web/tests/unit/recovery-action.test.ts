import { AuthApiError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const resetMock = vi.fn();
const verifyOtpMock = vi.fn();
const updateUserMock = vi.fn();
const signOutMock = vi.fn();
const listFactorsMock = vi.fn();
const challengeAndVerifyMock = vi.fn();
const profileMock = vi.fn();
const freshMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/recovery", () => ({
  isRecoveryLinkFresh: freshMock,
  hasRecoverySession: sessionMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      resetPasswordForEmail: resetMock,
      verifyOtp: verifyOtpMock,
      updateUser: updateUserMock,
      signOut: signOutMock,
      mfa: { listFactors: listFactorsMock, challengeAndVerify: challengeAndVerifyMock },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: profileMock }) }),
    }),
  }),
}));

const { requestPasswordReset, resetPassword } = await import("@/lib/actions/recovery");

const input = { tokenHash: "abc_DEF-123", password: "a long enough password" };

beforeEach(() => {
  vi.clearAllMocks();
  resetMock.mockResolvedValue({ data: {}, error: null });
  freshMock.mockResolvedValue(true);
  verifyOtpMock.mockResolvedValue({ data: {}, error: null });
  updateUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  signOutMock.mockResolvedValue({ error: null });
  sessionMock.mockResolvedValue(false);
  listFactorsMock.mockResolvedValue({ data: { totp: [] } });
  challengeAndVerifyMock.mockResolvedValue({ data: {}, error: null });
  profileMock.mockResolvedValue({ data: { account_kind: "worker" } });
});

describe("requestPasswordReset", () => {
  it("normalises the address and answers that a link was sent", async () => {
    expect(await requestPasswordReset({ email: " Ana@Example.COM " })).toEqual({ sent: true });
    expect(resetMock).toHaveBeenCalledWith("ana@example.com");
  });

  it("answers alike for the per-address interval, an unknown address and an unexpected failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resetMock.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError(
        "For security purposes, you can only request this after 59 seconds.",
        429,
        "over_email_send_rate_limit",
      ),
    });
    resetMock.mockResolvedValueOnce({ data: {}, error: new AuthApiError("gone", 400, "user_not_found") });
    resetMock.mockResolvedValueOnce({ data: {}, error: new AuthApiError("smtp down", 500, "unexpected_failure") });
    for (const email of ["a@example.test", "b@example.test", "c@example.test"]) {
      expect(await requestPasswordReset({ email })).toEqual({ sent: true });
    }
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it.each([
    ["the Auth request limit", new AuthApiError("limit", 429, "over_request_rate_limit")],
    ["the hourly email cap", new AuthApiError("cap", 429, "over_email_send_rate_limit")],
  ])("reports %s without naming the account", async (_label, error) => {
    resetMock.mockResolvedValue({ data: {}, error });
    expect(await requestPasswordReset({ email: "a@example.test" })).toEqual({
      message: "Too many attempts. Try again in a few minutes.",
    });
  });

  it("refuses an invalid address without calling Auth", async () => {
    const result = await requestPasswordReset({ email: "nope" });
    expect(result.errors?.email).toBe("Enter a valid email address.");
    expect(resetMock).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  it("verifies the link, saves the password, ends the other sessions and lands on the dashboard", async () => {
    await expect(resetPassword(input)).rejects.toThrow("REDIRECT:/en/dashboard/worker");
    expect(verifyOtpMock).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc_DEF-123" });
    expect(updateUserMock).toHaveBeenCalledWith({ password: "a long enough password" });
    expect(signOutMock).toHaveBeenCalledWith({ scope: "others" });
    expect(verifyOtpMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateUserMock.mock.invocationCallOrder[0],
    );
    expect(updateUserMock.mock.invocationCallOrder[0]).toBeLessThan(
      signOutMock.mock.invocationCallOrder[0],
    );
  });

  it("refuses an 11-character password without using the link up", async () => {
    const result = await resetPassword({ ...input, password: "elevenchars" });
    expect(result).toEqual({ errors: { password: "Password must be at least 12 characters." } });
    expect(freshMock).not.toHaveBeenCalled();
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("accepts exactly 12 characters and refuses more than 72 bytes", async () => {
    await expect(resetPassword({ ...input, password: "twelve chars" })).rejects.toThrow("REDIRECT:");
    const long = await resetPassword({ ...input, password: "x".repeat(73) });
    expect(long?.errors?.password).toBe("Password is too long: use at most 72 characters.");
  });

  it("sends an expired, used or superseded link back to the explanation page and spends nothing", async () => {
    freshMock.mockResolvedValue(false);
    await expect(resetPassword(input)).rejects.toThrow("REDIRECT:/en/reset-password");
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("sends a link that Auth refuses to the explanation page", async () => {
    verifyOtpMock.mockResolvedValue({
      data: {},
      error: new AuthApiError("expired", 403, "otp_expired"),
    });
    await expect(resetPassword(input)).rejects.toThrow("REDIRECT:/en/reset-password");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("lets the session opened by a spent link finish after a refused password", async () => {
    freshMock.mockResolvedValue(false);
    sessionMock.mockResolvedValue(true);
    await expect(resetPassword(input)).rejects.toThrow("REDIRECT:/en/dashboard/worker");
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(updateUserMock).toHaveBeenCalled();
  });

  it("does not let a session without a spent link change the password", async () => {
    freshMock.mockResolvedValue(false);
    sessionMock.mockResolvedValue(false);
    await expect(resetPassword(input)).rejects.toThrow("REDIRECT:/en/reset-password");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("maps a breached password and an unchanged password to field errors", async () => {
    updateUserMock.mockResolvedValueOnce({
      data: {},
      error: new AuthWeakPasswordError("weak", 422, ["pwned"]),
    });
    expect(await resetPassword(input)).toEqual({
      errors: { password: "This password has appeared in a data breach. Choose another one." },
    });
    updateUserMock.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError("same", 422, "same_password"),
    });
    expect(await resetPassword(input)).toEqual({
      errors: { password: "Choose a password different from your current one." },
    });
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("asks for the authenticator code when Auth requires the second step", async () => {
    updateUserMock.mockResolvedValue({
      data: {},
      error: new AuthApiError("AAL2 session is required", 403, "insufficient_aal"),
    });
    expect(await resetPassword(input)).toEqual({ needsCode: true });
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("verifies the code against the verified factors, trying each, before saving", async () => {
    listFactorsMock.mockResolvedValue({ data: { totp: [{ id: "phone" }, { id: "laptop" }] } });
    challengeAndVerifyMock
      .mockResolvedValueOnce({ data: null, error: new AuthApiError("no", 400, "mfa_verification_failed") })
      .mockResolvedValueOnce({ data: {}, error: null });
    freshMock.mockResolvedValue(false);
    sessionMock.mockResolvedValue(true);
    await expect(resetPassword({ ...input, code: "123456" })).rejects.toThrow("REDIRECT:");
    expect(challengeAndVerifyMock).toHaveBeenNthCalledWith(1, { factorId: "phone", code: "123456" });
    expect(challengeAndVerifyMock).toHaveBeenNthCalledWith(2, { factorId: "laptop", code: "123456" });
    expect(challengeAndVerifyMock.mock.invocationCallOrder[1]).toBeLessThan(
      updateUserMock.mock.invocationCallOrder[0],
    );
  });

  it("refuses a wrong code and saves nothing", async () => {
    listFactorsMock.mockResolvedValue({ data: { totp: [{ id: "phone" }] } });
    challengeAndVerifyMock.mockResolvedValue({
      data: null,
      error: new AuthApiError("no", 400, "mfa_verification_failed"),
    });
    expect(await resetPassword({ ...input, code: "000000" })).toEqual({
      errors: { code: "The code is incorrect or has expired." },
    });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it.each(["12345", "1234567", "12345a", " 123456"])("refuses the malformed code %j without calling Auth", async (code) => {
    const result = await resetPassword({ ...input, code });
    expect(result?.errors?.code).toBe("Enter the 6-digit code from your authenticator app.");
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("goes on when the other sessions cannot be ended, logging only the code and status", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    signOutMock.mockResolvedValue({ error: new AuthApiError("down", 500, "unexpected_failure") });
    await expect(resetPassword(input)).rejects.toThrow("REDIRECT:/en/dashboard/worker");
    expect(logged).toHaveBeenCalledWith("Sign-out of other sessions failed", {
      code: "unexpected_failure",
      status: 500,
    });
    logged.mockRestore();
  });

  it("returns a generic message for an unexpected failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    updateUserMock.mockResolvedValue({
      data: {},
      error: new AuthApiError("boom", 500, "unexpected_failure"),
    });
    expect(await resetPassword(input)).toEqual({
      message: "We could not complete this request. Try again.",
    });
    logged.mockRestore();
  });
});
