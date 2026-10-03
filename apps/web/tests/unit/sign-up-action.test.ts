import { AuthApiError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LegalDocumentSummary } from "@/lib/validation/consents";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const signUpMock = vi.fn();
const resendMock = vi.fn();
const documentsMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/legal", () => ({ getSignupDocuments: documentsMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signUp: signUpMock, resend: resendMock },
  }),
}));

const { resendConfirmation, signUp } = await import("@/lib/actions/auth");

const documents: LegalDocumentSummary[] = ["terms-of-service", "worker-terms", "age-18-plus"].map(
  (slug) => ({
    slug,
    title: `Title of ${slug}`,
    version: 2,
    publishedAt: "2026-10-01T00:00:00Z",
    changeSummary: "Changed.",
  }),
);
const consents = documents.map(({ slug, version }) => ({ purpose: slug, version }));
const input = {
  kind: "worker" as const,
  email: "  Ana@Example.COM ",
  password: "correct horse battery",
  consents,
};

beforeEach(() => {
  vi.clearAllMocks();
  documentsMock.mockResolvedValue(documents);
  signUpMock.mockResolvedValue({ data: {}, error: null });
});

describe("signUp action", () => {
  it("sends only the intended kind and the pending consents as metadata, then goes to verify-email", async () => {
    await expect(signUp(input)).rejects.toThrow("REDIRECT:/en/verify-email");
    expect(signUpMock).toHaveBeenCalledWith({
      email: "ana@example.com",
      password: input.password,
      options: {
        data: { intended_account_kind: "worker", pending_consents: consents },
      },
    });
  });

  it("refuses invalid input with field messages and never echoes the password or calls Auth", async () => {
    const result = await signUp({ ...input, password: "short-pass" });
    expect(result).toEqual({
      errors: { password: "Password must be at least 12 characters." },
    });
    expect(JSON.stringify(result)).not.toContain("short-pass");
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("refuses a direct call without a consent or the age attestation and creates no account", async () => {
    const result = await signUp({
      ...input,
      consents: consents.filter(({ purpose }) => purpose !== "age-18-plus"),
    });
    expect(result).toEqual({
      errors: {
        "accepted.age-18-plus": "Confirm that you are 18 or older to create an account",
      },
    });
    const privacy = await signUp({
      ...input,
      consents: consents.filter(({ purpose }) => purpose !== "terms-of-service"),
    });
    expect(privacy?.errors?.["accepted.terms-of-service"]).toBe(
      "Accept the Title of terms-of-service to continue",
    );
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("refuses a consent for a version other than the current one", async () => {
    const result = await signUp({
      ...input,
      consents: consents.map((entry) => ({ ...entry, version: 1 })),
    });
    expect(Object.keys(result?.errors ?? {})).toHaveLength(3);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("maps a breached password to its message on the password field", async () => {
    signUpMock.mockResolvedValue({
      data: {},
      error: new AuthWeakPasswordError("Password is known to be weak", 422, ["pwned"]),
    });
    expect(await signUp(input)).toEqual({
      errors: {
        password: "This password has appeared in a data breach. Choose another one.",
      },
    });
  });

  it.each([
    [
      "the per-address minimum interval",
      new AuthApiError("For security purposes, you can only request this after 59 seconds.", 429, "over_email_send_rate_limit"),
    ],
    ["an address that already has an account", new AuthApiError("User already registered", 422, "user_already_exists")],
  ])("answers %s like a new sign-up so no address is revealed", async (_label, error) => {
    signUpMock.mockResolvedValue({ data: {}, error });
    await expect(signUp(input)).rejects.toThrow("REDIRECT:/en/verify-email");
  });

  it.each([
    ["the Auth request limit", new AuthApiError("limit", 429, "over_request_rate_limit")],
    ["the hourly email cap", new AuthApiError("email rate limit exceeded", 429, "over_email_send_rate_limit")],
  ])("tells the visitor about %s", async (_label, error) => {
    signUpMock.mockResolvedValue({ data: {}, error });
    expect(await signUp(input)).toEqual({
      message: "Too many attempts. Try again in a few minutes.",
    });
  });

  it("returns a generic message for any other failure without internals", async () => {
    signUpMock.mockResolvedValue({
      data: {},
      error: new AuthApiError("Database error saving new user", 500, "unexpected_failure"),
    });
    const result = await signUp(input);
    expect(result).toEqual({ message: "We could not complete this request. Try again." });
  });
});

describe("resendConfirmation action", () => {
  it("answers alike for every address and throttle outcome", async () => {
    resendMock.mockResolvedValueOnce({ data: {}, error: null });
    resendMock.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError("For security purposes, you can only request this after 59 seconds.", 429, "over_email_send_rate_limit"),
    });
    resendMock.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError("gone", 400, "user_not_found"),
    });
    for (const email of ["a@example.test", "b@example.test", "c@example.test"]) {
      expect(await resendConfirmation({ email })).toEqual({ sent: true });
    }
    expect(resendMock).toHaveBeenCalledWith({ type: "signup", email: "a@example.test" });
  });

  it("refuses an invalid address without calling Auth", async () => {
    const result = await resendConfirmation({ email: "nope" });
    expect(result.errors?.email).toBe("Enter a valid email address.");
    expect(resendMock).not.toHaveBeenCalled();
  });

  it.each([
    ["the Auth request limit", new AuthApiError("limit", 429, "over_request_rate_limit")],
    ["the hourly email cap", new AuthApiError("email rate limit exceeded", 429, "over_email_send_rate_limit")],
  ])("reports %s", async (_label, error) => {
    resendMock.mockResolvedValue({ data: {}, error });
    expect(await resendConfirmation({ email: "a@example.test" })).toEqual({
      message: "Too many attempts. Try again in a few minutes.",
    });
  });
});
