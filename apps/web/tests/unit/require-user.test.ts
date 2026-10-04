import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const headerValues = vi.hoisted(() => ({ pathname: null as string | null }));
const claimsMock = vi.fn();
const profileMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => headerValues.pathname }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: claimsMock },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: profileMock }) }),
    }),
    rpc: rpcMock,
  }),
}));

const { requireUser } = await import("@/lib/dal/session");

function pending(slug: string) {
  return {
    slug,
    title: "T",
    version: 2,
    published_at: "2026-10-01T00:00:00Z",
    change_summary: "Changed.",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  headerValues.pathname = "/en/onboarding?x=1";
  claimsMock.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
  profileMock.mockResolvedValue({
    data: { account_kind: "worker", intended_account_kind: "worker", status: "active" },
  });
  rpcMock.mockResolvedValue({ data: [], error: null });
});

describe("requireUser", () => {
  it("sends a visitor without a session to log in and remembers the page asked for", async () => {
    claimsMock.mockResolvedValue({ data: null });
    await expect(requireUser("en")).rejects.toThrow(
      `REDIRECT:/en/login?next=${encodeURIComponent("/en/onboarding?x=1")}`,
    );
  });

  it("does not carry an off-site or missing path into the login redirect", async () => {
    claimsMock.mockResolvedValue({ data: null });
    for (const pathname of ["//evil.example", "https://evil.example", null]) {
      headerValues.pathname = pathname;
      await expect(requireUser("en")).rejects.toThrow("REDIRECT:/en/login");
    }
  });

  it("refuses a suspended account with the suspended page and reads nothing else", async () => {
    profileMock.mockResolvedValue({
      data: { account_kind: "worker", intended_account_kind: "worker", status: "suspended" },
    });
    await expect(requireUser("en")).rejects.toThrow("REDIRECT:/en/suspended");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns the user when nothing is pending", async () => {
    await expect(requireUser("en")).resolves.toEqual({
      id: "user-1",
      accountKind: "worker",
      intendedAccountKind: "worker",
      suspended: false,
    });
  });

  it("holds a user with a pending document on the consent page and remembers the page asked for", async () => {
    rpcMock.mockResolvedValue({ data: [pending("terms-of-service")], error: null });
    await expect(requireUser("en")).rejects.toThrow(
      `REDIRECT:/en/consent?next=${encodeURIComponent("/en/onboarding?x=1")}`,
    );
  });

  it("does not trust a requested path that points off site", async () => {
    headerValues.pathname = "//evil.example";
    rpcMock.mockResolvedValue({ data: [pending("terms-of-service")], error: null });
    await expect(requireUser("en")).rejects.toThrow(
      `REDIRECT:/en/consent?next=${encodeURIComponent("/")}`,
    );
  });

  it("skips the gate for the consent page", async () => {
    rpcMock.mockResolvedValue({ data: [pending("terms-of-service")], error: null });
    await expect(requireUser("en", { consentGate: false })).resolves.toMatchObject({
      id: "user-1",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not ask for consents before the account kind is committed", async () => {
    profileMock.mockResolvedValue({
      data: { account_kind: null, intended_account_kind: "company", status: "active" },
    });
    await expect(requireUser("en")).resolves.toMatchObject({
      accountKind: null,
      intendedAccountKind: "company",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed when the pending consents cannot be read", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(requireUser("en")).rejects.toThrow("pending consents could not be loaded");
  });
});
