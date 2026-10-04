import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const listFactorsMock = vi.fn();
const unenrollMock = vi.fn();
const enrollMock = vi.fn();
const challengeAndVerifyMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
const client = {
  auth: {
    mfa: {
      listFactors: listFactorsMock,
      unenroll: unenrollMock,
      enroll: enrollMock,
      challengeAndVerify: challengeAndVerifyMock,
    },
  },
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

const { hasVerifiedTotpFactor, listVerifiedFactors, startEnrolment, verifyAnyTotp, verifyTotp } = await import(
  "@/lib/dal/mfa"
);

function factor(id: string, name: string, status: "verified" | "unverified", type = "totp") {
  return { id, friendly_name: name, status, factor_type: type, created_at: "2026-10-04T10:00:00Z" };
}

function factors(...all: ReturnType<typeof factor>[]) {
  return { data: { all, totp: all.filter((f) => f.status === "verified" && f.factor_type === "totp") }, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  unenrollMock.mockResolvedValue({ data: {}, error: null });
  enrollMock.mockResolvedValue({
    data: { id: "new-factor", type: "totp", totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: "JBSWY3DPEHPK3PXP" } },
    error: null,
  });
});

describe("listVerifiedFactors and hasVerifiedTotpFactor", () => {
  it("lists only the verified TOTP factors, with name and date", async () => {
    listFactorsMock.mockResolvedValue(
      factors(
        factor("f1", "Authenticator", "verified"),
        factor("f2", "Backup", "unverified"),
        factor("f3", "Phone", "verified", "phone"),
      ),
    );
    await expect(listVerifiedFactors("en")).resolves.toEqual([
      { id: "f1", name: "Authenticator", createdAt: "2026-10-04T10:00:00Z" },
    ]);
  });

  it("is true when a verified factor exists and false when only an unfinished enrolment does", async () => {
    listFactorsMock.mockResolvedValueOnce(factors(factor("f1", "Authenticator", "verified")));
    await expect(hasVerifiedTotpFactor("en")).resolves.toBe(true);
    listFactorsMock.mockResolvedValueOnce(factors(factor("f2", "Authenticator", "unverified")));
    await expect(hasVerifiedTotpFactor("en")).resolves.toBe(false);
  });

  it.each([
    ["a missing session", new AuthSessionMissingError()],
    ["a revoked session", { status: 403, code: "session_not_found", message: "Session not found" }],
  ])("sends the user to the login page for %s", async (_name, error) => {
    listFactorsMock.mockResolvedValue({ data: null, error });
    await expect(hasVerifiedTotpFactor("en")).rejects.toThrow("REDIRECT:/en/login");
  });

  it("throws for any other failure", async () => {
    listFactorsMock.mockResolvedValue({ data: null, error: { status: 500, message: "boom" } });
    await expect(hasVerifiedTotpFactor("en")).rejects.toThrow("could not be loaded");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("startEnrolment", () => {
  it("removes an abandoned enrolment before it enrols, so the name is free and the limit is not used up", async () => {
    listFactorsMock.mockResolvedValue(factors(factor("old", "Authenticator", "unverified")));
    await expect(startEnrolment("en", "Authenticator", "aal1")).resolves.toEqual({
      factorId: "new-factor",
      qrCode: "data:image/svg+xml;utf-8,<svg/>",
      secret: "JBSWY3DPEHPK3PXP",
    });
    expect(unenrollMock).toHaveBeenCalledWith({ factorId: "old" });
    expect(enrollMock).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "Authenticator" });
    expect(unenrollMock.mock.invocationCallOrder[0]).toBeLessThan(enrollMock.mock.invocationCallOrder[0]);
  });

  it("never touches a verified factor", async () => {
    listFactorsMock.mockResolvedValue(
      factors(factor("keep", "Authenticator", "verified"), factor("old", "Backup", "unverified")),
    );
    await startEnrolment("en", "Backup phone", "aal2");
    expect(unenrollMock).toHaveBeenCalledTimes(1);
    expect(unenrollMock).toHaveBeenCalledWith({ factorId: "old" });
  });

  it("refuses a third device before it asks Auth", async () => {
    listFactorsMock.mockResolvedValue(
      factors(factor("a", "Authenticator", "verified"), factor("b", "Backup", "verified")),
    );
    await expect(startEnrolment("en", "Third", "aal2")).resolves.toEqual({ refused: "too_many" });
    expect(unenrollMock).not.toHaveBeenCalled();
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("refuses a further device to a session at aal1 before it touches Auth, as the second factor would be bypassed", async () => {
    listFactorsMock.mockResolvedValue(
      factors(factor("a", "Authenticator", "verified"), factor("old", "Backup", "unverified")),
    );
    await expect(startEnrolment("en", "Backup phone", "aal1")).resolves.toEqual({ refused: "aal2_required" });
    expect(unenrollMock).not.toHaveBeenCalled();
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("refuses the name of a verified device before it asks Auth", async () => {
    listFactorsMock.mockResolvedValue(factors(factor("a", "Backup phone", "verified")));
    await expect(startEnrolment("en", "Backup phone", "aal2")).resolves.toEqual({ refused: "name_taken" });
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it.each([
    ["mfa_factor_name_conflict", "name_taken"],
    ["too_many_enrolled_mfa_factors", "too_many"],
    ["insufficient_aal", "aal2_required"],
  ])("maps the Auth answer %s to the refusal %s", async (code, refused) => {
    listFactorsMock.mockResolvedValue(factors());
    enrollMock.mockResolvedValue({ data: null, error: new AuthApiError("no", 422, code) });
    await expect(startEnrolment("en", "Backup", "aal1")).resolves.toEqual({ refused });
  });

  it("throws, without a secret in the message, for any other failure", async () => {
    listFactorsMock.mockResolvedValue(factors());
    enrollMock.mockResolvedValue({ data: null, error: new AuthApiError("down", 500, "unexpected_failure") });
    await expect(startEnrolment("en", "Backup", "aal1")).rejects.toThrow("could not be started");
  });

  it("throws when an abandoned enrolment cannot be removed rather than enrolling next to it", async () => {
    listFactorsMock.mockResolvedValue(factors(factor("old", "Authenticator", "unverified")));
    unenrollMock.mockResolvedValue({ data: null, error: new AuthApiError("down", 500, "unexpected_failure") });
    await expect(startEnrolment("en", "Authenticator", "aal1")).rejects.toThrow("could not be removed");
    expect(enrollMock).not.toHaveBeenCalled();
  });
});

const wrongCode = () => new AuthApiError("no", 422, "mfa_verification_failed");
const rateLimit = () => new AuthApiError("slow down", 429, "over_request_rate_limit");

describe("verifyTotp", () => {
  it("is null for a valid code and asks Auth about the one factor only", async () => {
    challengeAndVerifyMock.mockResolvedValue({ data: {}, error: null });
    await expect(verifyTotp(client as never, "a", "123456")).resolves.toBeNull();
    expect(challengeAndVerifyMock).toHaveBeenCalledTimes(1);
    expect(challengeAndVerifyMock).toHaveBeenCalledWith({ factorId: "a", code: "123456" });
  });

  it("hands back the Auth error, so a rate limit is not mistaken for a wrong code", async () => {
    challengeAndVerifyMock.mockResolvedValue({ data: null, error: rateLimit() });
    await expect(verifyTotp(client as never, "a", "123456")).resolves.toMatchObject({ status: 429 });
  });
});

describe("verifyAnyTotp", () => {
  it("tries each verified factor and stops at the first that accepts the code", async () => {
    listFactorsMock.mockResolvedValue({ data: { totp: [{ id: "a" }, { id: "b" }, { id: "c" }] }, error: null });
    challengeAndVerifyMock
      .mockResolvedValueOnce({ data: null, error: wrongCode() })
      .mockResolvedValueOnce({ data: {}, error: null });
    await expect(verifyAnyTotp(client as never, "123456")).resolves.toBeNull();
    expect(challengeAndVerifyMock).toHaveBeenCalledTimes(2);
  });

  it("answers a wrong code with the wrong-code error", async () => {
    listFactorsMock.mockResolvedValue({ data: { totp: [{ id: "a" }, { id: "b" }] }, error: null });
    challengeAndVerifyMock.mockResolvedValue({ data: null, error: wrongCode() });
    await expect(verifyAnyTotp(client as never, "000000")).resolves.toMatchObject({ code: "mfa_verification_failed" });
    expect(challengeAndVerifyMock).toHaveBeenCalledTimes(2);
  });

  it("reports a rate limit of the second factor rather than the wrong code of the first", async () => {
    listFactorsMock.mockResolvedValue({ data: { totp: [{ id: "a" }, { id: "b" }] }, error: null });
    challengeAndVerifyMock
      .mockResolvedValueOnce({ data: null, error: wrongCode() })
      .mockResolvedValueOnce({ data: null, error: rateLimit() });
    await expect(verifyAnyTotp(client as never, "123456")).resolves.toMatchObject({ status: 429 });
  });

  it("reports a failure of the first factor even when the second answers wrong", async () => {
    listFactorsMock.mockResolvedValue({ data: { totp: [{ id: "a" }, { id: "b" }] }, error: null });
    challengeAndVerifyMock
      .mockResolvedValueOnce({ data: null, error: new AuthApiError("down", 500, "unexpected_failure") })
      .mockResolvedValueOnce({ data: null, error: wrongCode() });
    await expect(verifyAnyTotp(client as never, "123456")).resolves.toMatchObject({ code: "unexpected_failure" });
  });

  it("reports the failure to list the factors", async () => {
    listFactorsMock.mockResolvedValue({ data: null, error: new AuthApiError("down", 500, "unexpected_failure") });
    await expect(verifyAnyTotp(client as never, "123456")).resolves.toMatchObject({ status: 500 });
    expect(challengeAndVerifyMock).not.toHaveBeenCalled();
  });

  it("answers a user with no verified factor like a wrong code", async () => {
    listFactorsMock.mockResolvedValue({ data: { totp: [] }, error: null });
    await expect(verifyAnyTotp(client as never, "123456")).resolves.toMatchObject({ code: "mfa_verification_failed" });
    expect(challengeAndVerifyMock).not.toHaveBeenCalled();
  });
});
