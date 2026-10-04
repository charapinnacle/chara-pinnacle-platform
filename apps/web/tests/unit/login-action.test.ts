import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const signInMock = vi.fn();
const signOutMock = vi.fn();
const userMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser: userMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: signInMock, signOut: signOutMock },
  }),
}));

const { signIn, signOut } = await import("@/lib/actions/login");

const input = { email: "  Ana@Example.COM ", password: "any password at all" };

beforeEach(() => {
  vi.clearAllMocks();
  signInMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  signOutMock.mockResolvedValue({ error: null });
  userMock.mockResolvedValue({ id: "user-1", accountKind: "worker", suspended: false });
});

describe("signIn", () => {
  it("normalises the email, sends the password as typed and lands a worker on the worker dashboard", async () => {
    await expect(signIn(input)).rejects.toThrow("REDIRECT:/en/dashboard/worker");
    expect(signInMock).toHaveBeenCalledWith({
      email: "ana@example.com",
      password: "any password at all",
    });
  });

  it("lands an employer on the employer dashboard and an uncommitted account on onboarding", async () => {
    userMock.mockResolvedValue({ id: "user-1", accountKind: "company", suspended: false });
    await expect(signIn(input)).rejects.toThrow("REDIRECT:/en/dashboard/employer");
    userMock.mockResolvedValue({ id: "user-1", accountKind: null, suspended: false });
    await expect(signIn(input)).rejects.toThrow("REDIRECT:/en/onboarding");
  });

  it("honours a relative next path", async () => {
    await expect(signIn({ ...input, next: "/en/org/acme-bau/members" })).rejects.toThrow(
      "REDIRECT:/en/org/acme-bau/members",
    );
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", ""])(
    "ignores the next value %j and lands on the user's own dashboard",
    async (next) => {
      await expect(signIn({ ...input, next })).rejects.toThrow("REDIRECT:/en/dashboard/worker");
    },
  );

  it("does not call Auth for an invalid email or an empty password and never echoes the password", async () => {
    const bad = await signIn({ email: "nope", password: "" });
    expect(bad?.errors).toEqual({
      email: "Enter a valid email address.",
      password: "Enter your password.",
    });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("does not length-check a short password on login", async () => {
    await expect(signIn({ ...input, password: "x" })).rejects.toThrow("REDIRECT:");
  });

  it("refuses a password longer than any account can have, without calling Auth", async () => {
    const result = await signIn({ ...input, password: "x".repeat(73) });
    expect(result).toEqual({ errors: { password: "Email or password is incorrect." } });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("falls back to the home page for a next value over 2048 characters", async () => {
    await expect(signIn({ ...input, next: `/${"a".repeat(2048)}` })).rejects.toThrow("REDIRECT:/en/dashboard/worker");
    expect(signInMock).toHaveBeenCalledOnce();
  });

  it("answers a wrong password for a known and for an unknown address with the same message", async () => {
    signInMock.mockResolvedValue({
      data: {},
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    });
    const known = await signIn(input);
    const unknown = await signIn({ ...input, email: "nobody@example.test" });
    expect(known).toEqual({ message: "Email or password is incorrect." });
    expect(unknown).toEqual(known);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it.each([
    ["the Auth request limit", new AuthApiError("limit", 429, "over_request_rate_limit")],
    ["the Auth email cap", new AuthApiError("cap", 429, "over_email_send_rate_limit")],
  ])("answers %s with the rate-limit message and no word about the account", async (_label, error) => {
    signInMock.mockResolvedValue({ data: {}, error });
    const result = await signIn(input);
    expect(result).toEqual({ message: "Too many attempts. Try again in a few minutes." });
    expect(JSON.stringify(result)).not.toMatch(/account|email or password/i);
  });

  it("asks an unconfirmed user to confirm the address", async () => {
    signInMock.mockResolvedValue({
      data: {},
      error: new AuthApiError("Email not confirmed", 400, "email_not_confirmed"),
    });
    expect(await signIn(input)).toEqual({
      message: "Confirm your email address before you log in.",
      unconfirmed: true,
    });
  });

  it("tells a banned account that it is suspended and creates no session", async () => {
    signInMock.mockResolvedValue({
      data: {},
      error: new AuthApiError("User is banned", 400, "user_banned"),
    });
    expect(await signIn(input)).toEqual({
      message: "This account is suspended. See the email we sent you for the reasons.",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("ends the session at once when the profile is suspended without a ban", async () => {
    userMock.mockResolvedValue({ id: "user-1", accountKind: "worker", suspended: true });
    expect(await signIn(input)).toEqual({
      message: "This account is suspended. See the email we sent you for the reasons.",
    });
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns a generic message for any other failure and logs only its code and status", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    signInMock.mockResolvedValue({
      data: {},
      error: new AuthApiError("connect ECONNREFUSED 10.0.0.5", 500, "unexpected_failure"),
    });
    const result = await signIn(input);
    expect(result).toEqual({ message: "We could not complete this request. Try again." });
    expect(logged).toHaveBeenCalledWith("Login failed", { code: "unexpected_failure", status: 500 });
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/example|ECONNREFUSED|password/);
    logged.mockRestore();
  });
});

describe("signOut", () => {
  it("revokes this session only and goes to the login page", async () => {
    await expect(signOut()).rejects.toThrow("REDIRECT:/en/login");
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
  });

  it("stays on the page and reports a failure when Auth cannot revoke the session", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    signOutMock.mockResolvedValue({ error: new AuthApiError("down", 500, "unexpected_failure") });
    expect(await signOut()).toEqual({ message: "We could not complete this request. Try again." });
    expect(redirectMock).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
