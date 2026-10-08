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
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
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

const { requireCandidate, requirePlatformRole, requireUser } = await import("@/lib/dal/session");

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
  claimsMock.mockResolvedValue({ data: { claims: { sub: "user-1", email: "worker@example.test" } } });
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
      email: "worker@example.test",
      aal: "aal1",
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

describe("the session level", () => {
  it("reads aal2 from the verified claims and treats anything else as aal1", async () => {
    claimsMock.mockResolvedValue({ data: { claims: { sub: "user-1", aal: "aal2" } } });
    await expect(requireUser("en")).resolves.toMatchObject({ aal: "aal2" });
    claimsMock.mockResolvedValue({ data: { claims: { sub: "user-1", aal: "aal3" } } });
    await expect(requireUser("en")).resolves.toMatchObject({ aal: "aal1" });
  });
});

describe("requirePlatformRole", () => {
  const roles = (data: string[]) =>
    rpcMock.mockImplementation(async (name: string) => (name === "my_platform_roles" ? { data, error: null } : { data: [], error: null }));

  it("answers a user without an active role as not found, before any MFA prompt", async () => {
    await expect(requirePlatformRole("en")).rejects.toThrow("NOT_FOUND");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("sends active staff at aal1 to the MFA page with the requested page as next", async () => {
    headerValues.pathname = "/en/admin";
    roles(["trust_safety"]);
    await expect(requirePlatformRole("en")).rejects.toThrow(`REDIRECT:/en/mfa?next=${encodeURIComponent("/en/admin")}`);
  });

  it("asks staff at aal1 for the code before it says a page is outside their role", async () => {
    headerValues.pathname = "/en/admin/audit";
    roles(["trust_safety"]);
    await expect(requirePlatformRole("en", ["admin"])).rejects.toThrow("REDIRECT:/en/mfa");
  });

  it("does not carry an off-site path into next", async () => {
    headerValues.pathname = "//evil.example";
    roles(["admin"]);
    await expect(requirePlatformRole("en")).rejects.toThrow("REDIRECT:/en/mfa");
    expect(redirectMock).not.toHaveBeenCalledWith(expect.stringContaining("evil"));
  });

  it("lets active staff at aal2 through and returns the roles looked up", async () => {
    claimsMock.mockResolvedValue({ data: { claims: { sub: "user-1", aal: "aal2" } } });
    roles(["admin", "trust_safety"]);
    await expect(requirePlatformRole("en")).resolves.toMatchObject({ user: { id: "user-1", aal: "aal2" }, roles: ["admin", "trust_safety"] });
    await expect(requirePlatformRole("en", ["trust_safety"])).resolves.toMatchObject({ roles: ["admin", "trust_safety"] });
  });

  it("answers a page outside the roles of the staff member as not found", async () => {
    claimsMock.mockResolvedValue({ data: { claims: { sub: "user-1", aal: "aal2" } } });
    roles(["trust_safety"]);
    await expect(requirePlatformRole("en", ["admin"])).rejects.toThrow("NOT_FOUND");
    roles(["verification_reviewer"]);
    await expect(requirePlatformRole("en", ["admin", "trust_safety"])).rejects.toThrow("NOT_FOUND");
  });

  it("fails loudly when the roles cannot be loaded instead of treating the user as staff or not", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "my_platform_roles" ? { data: null, error: { message: "boom" } } : { data: [], error: null },
    );
    await expect(requirePlatformRole("en")).rejects.toThrow("could not be loaded");
  });
});

describe("requireCandidate", () => {
  const roles = (data: string[] | null, error: { message: string } | null = null) =>
    rpcMock.mockImplementation(async (name: string) => (name === "my_platform_roles" ? { data, error } : { data: [], error: null }));

  it("lets a candidate through without asking for the platform roles", async () => {
    await expect(requireCandidate("en")).resolves.toMatchObject({ id: "user-1", accountKind: "worker" });
    expect(rpcMock).not.toHaveBeenCalledWith("my_platform_roles");
  });

  it("sends a visitor to log in with the page asked for", async () => {
    claimsMock.mockResolvedValue({ data: null });
    headerValues.pathname = "/en/applications";
    await expect(requireCandidate("en")).rejects.toThrow(`REDIRECT:/en/login?next=${encodeURIComponent("/en/applications")}`);
  });

  it("sends a company user to the employer dashboard", async () => {
    profileMock.mockResolvedValue({ data: { account_kind: "company", intended_account_kind: "company", status: "active" } });
    roles([]);
    await expect(requireCandidate("en")).rejects.toThrow("REDIRECT:/en/dashboard/employer");
  });

  it("sends platform staff to the administration, whatever their account kind", async () => {
    profileMock.mockResolvedValue({ data: { account_kind: "company", intended_account_kind: "company", status: "active" } });
    roles(["trust_safety"]);
    await expect(requireCandidate("en")).rejects.toThrow("REDIRECT:/en/admin");
  });

  it("sends an account that has not chosen its kind to the step that finishes it", async () => {
    profileMock.mockResolvedValue({ data: { account_kind: null, intended_account_kind: "worker", status: "active" } });
    roles([]);
    await expect(requireCandidate("en")).rejects.toThrow("REDIRECT:/en/onboarding");
  });

  it("fails loudly when the roles cannot be loaded", async () => {
    profileMock.mockResolvedValue({ data: { account_kind: "company", intended_account_kind: "company", status: "active" } });
    roles(null, { message: "boom" });
    await expect(requireCandidate("en")).rejects.toThrow("could not be loaded");
  });
});
