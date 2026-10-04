import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeMock = vi.fn();
const signOutMock = vi.fn();
const throttledMock = vi.hoisted(() => vi.fn());
const currentUserMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/rate-limit", () => ({ isThrottled: throttledMock }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser: currentUserMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: exchangeMock, signOut: signOutMock },
  }),
}));

const { GET } = await import("@/app/auth/callback/route");

const CODE = "0b8f0b34-1f2c-4c53-9a3f-5b2d9a7c1e11";

function callback(query: string) {
  return GET(new NextRequest(`http://localhost:3100/auth/callback${query}`));
}

function verifiedUser() {
  return {
    email_confirmed_at: "2026-10-04T10:00:00Z",
    identities: [{ provider: "google", identity_data: { email_verified: true } }],
  };
}

function location(response: Response) {
  return response.headers.get("location");
}

beforeEach(() => {
  vi.clearAllMocks();
  throttledMock.mockResolvedValue(false);
  exchangeMock.mockResolvedValue({ data: { user: verifiedUser() }, error: null });
  signOutMock.mockResolvedValue({ error: null });
  currentUserMock.mockResolvedValue({ accountKind: null, suspended: false });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("auth callback", () => {
  it("sends an account with no kind to onboarding after exchanging the code", async () => {
    const response = await callback(`?code=${CODE}`);
    expect(exchangeMock).toHaveBeenCalledWith(CODE);
    expect(response.status).toBe(307);
    expect(location(response)).toBe("http://localhost:3100/en/onboarding");
  });

  it.each([
    ["worker", "http://localhost:3100/en/dashboard/worker"],
    ["company", "http://localhost:3100/en/dashboard/employer"],
  ])("sends a committed %s to the dashboard of its kind", async (accountKind, expected) => {
    currentUserMock.mockResolvedValue({ accountKind, suspended: false });
    expect(location(await callback(`?code=${CODE}`))).toBe(expected);
  });

  it("never takes the destination from the request", async () => {
    for (const next of ["https://evil.example", "//evil.example", "/en/org/acme"]) {
      const response = await callback(`?code=${CODE}&next=${encodeURIComponent(next)}`);
      expect(location(response)).toBe("http://localhost:3100/en/onboarding");
    }
  });

  it.each([
    ["?error=access_denied&error_description=The+user+denied", "cancelled"],
    ["?error=server_error&error_code=provider_email_needs_verification", "email_unverified"],
    ["?error=server_error&error_code=user_banned", "suspended"],
    ["?error=server_error&error_code=signup_disabled", "unavailable"],
    ["?error=server_error&error_code=something_new", "failed"],
  ])("maps an error from Auth in %s to the login page with %s", async (query, code) => {
    const response = await callback(query);
    expect(location(response)).toBe(`http://localhost:3100/en/login?error=${code}`);
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it.each(["", "?code=", "?code=has space", `?code=${"a".repeat(201)}`, "?code=a%2Fb"])(
    "refuses %j without calling Auth",
    async (query) => {
      const response = await callback(query);
      expect(location(response)).toBe("http://localhost:3100/en/login?error=failed");
      expect(exchangeMock).not.toHaveBeenCalled();
    },
  );

  it("counts the attempt against the visitor and refuses before calling Auth when over the limit", async () => {
    throttledMock.mockResolvedValue(true);
    const response = await callback(`?code=${CODE}`);
    expect(throttledMock).toHaveBeenCalledWith("login");
    expect(location(response)).toBe("http://localhost:3100/en/login?error=rate_limited");
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("maps a failed exchange to the login page and does not repeat what Auth said", async () => {
    exchangeMock.mockResolvedValue({
      data: { user: null },
      error: { code: "flow_state_expired", status: 400, message: "secret detail" },
    });
    const response = await callback(`?code=${CODE}`);
    expect(location(response)).toBe("http://localhost:3100/en/login?error=failed");
    expect(location(response)).not.toContain("secret");
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("maps a banned user at the exchange to the suspended message", async () => {
    exchangeMock.mockResolvedValue({ data: { user: null }, error: { code: "user_banned", status: 403, message: "x" } });
    expect(location(await callback(`?code=${CODE}`))).toBe("http://localhost:3100/en/login?error=suspended");
  });

  it("signs out and refuses a Google identity whose email is not verified", async () => {
    exchangeMock.mockResolvedValue({
      data: {
        user: {
          email_confirmed_at: "2026-10-04T10:00:00Z",
          identities: [{ provider: "google", identity_data: { email_verified: false } }],
        },
      },
      error: null,
    });
    const response = await callback(`?code=${CODE}`);
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
    expect(location(response)).toBe("http://localhost:3100/en/login?error=email_unverified");
    expect(currentUserMock).not.toHaveBeenCalled();
  });

  it("signs out and refuses a suspended profile", async () => {
    currentUserMock.mockResolvedValue({ accountKind: "worker", suspended: true });
    const response = await callback(`?code=${CODE}`);
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
    expect(location(response)).toBe("http://localhost:3100/en/login?error=suspended");
  });
});
