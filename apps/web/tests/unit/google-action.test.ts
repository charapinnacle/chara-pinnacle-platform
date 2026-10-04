import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const oauthMock = vi.fn();
const throttledMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/rate-limit", () => ({ isThrottled: throttledMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithOAuth: oauthMock } }),
}));

const { continueWithGoogle } = await import("@/lib/actions/google");

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("GOOGLE_SIGN_IN_ENABLED", "true");
  throttledMock.mockResolvedValue(false);
  oauthMock.mockResolvedValue({
    data: { provider: "google", url: "http://127.0.0.1:54421/auth/v1/authorize?provider=google" },
    error: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("continueWithGoogle", () => {
  it("starts the Google flow with the callback of this site and sends the browser to Auth", async () => {
    await expect(continueWithGoogle()).rejects.toThrow(
      "REDIRECT:http://127.0.0.1:54421/auth/v1/authorize?provider=google",
    );
    expect(oauthMock).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost:3100/auth/callback" },
    });
    expect(throttledMock).toHaveBeenCalledWith("login");
  });

  it.each([undefined, "", "false"])("refuses and starts nothing while the flag is %j", async (flag) => {
    if (flag === undefined) vi.stubEnv("GOOGLE_SIGN_IN_ENABLED", undefined);
    else vi.stubEnv("GOOGLE_SIGN_IN_ENABLED", flag);
    await expect(continueWithGoogle()).rejects.toThrow("REDIRECT:/en/login?error=unavailable");
    expect(oauthMock).not.toHaveBeenCalled();
    expect(throttledMock).not.toHaveBeenCalled();
  });

  it("refuses a visitor over the limit before calling Auth", async () => {
    throttledMock.mockResolvedValue(true);
    await expect(continueWithGoogle()).rejects.toThrow("REDIRECT:/en/login?error=rate_limited");
    expect(oauthMock).not.toHaveBeenCalled();
  });

  it("returns to the login page with a plain failure when Auth cannot build the URL", async () => {
    oauthMock.mockResolvedValue({ data: { provider: "google", url: null }, error: { code: "unexpected_failure", status: 500, message: "boom" } });
    await expect(continueWithGoogle()).rejects.toThrow("REDIRECT:/en/login?error=failed");
  });
});
