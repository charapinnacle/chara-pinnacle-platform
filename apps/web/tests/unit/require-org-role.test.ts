import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const headerValues = vi.hoisted(() => ({ pathname: "/en/org/acme-bau/members" as string | null }));
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);
const claimsMock = vi.fn();
const profileMock = vi.fn();
const membershipMock = vi.fn();
const eqCalls: [string, unknown][] = [];

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock, notFound: notFoundMock }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => headerValues.pathname }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: claimsMock },
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (column: string, value: unknown) => {
        eqCalls.push([`${table}.${column}`, value]);
        return table === "profiles" ? { maybeSingle: profileMock } : chain;
      };
      chain.not = () => chain;
      chain.maybeSingle = membershipMock;
      return chain;
    },
  }),
}));

const { requireOrgRole } = await import("@/lib/dal/session");

function membership(role: "owner" | "admin" | "member") {
  return { data: { role, organizations: { id: "org-1", slug: "acme-bau", display_name: "Acme Bau" } }, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
  headerValues.pathname = "/en/org/acme-bau/members";
  claimsMock.mockResolvedValue({ data: { claims: { sub: "user-1", aal: "aal2" } } });
  profileMock.mockResolvedValue({
    data: { account_kind: "company", intended_account_kind: "company", status: "active" },
  });
  membershipMock.mockResolvedValue(membership("owner"));
});

describe("requireOrgRole", () => {
  it("looks the membership up by user and slug and returns the organization with the role", async () => {
    await expect(requireOrgRole("en", "acme-bau", "member")).resolves.toMatchObject({
      user: { id: "user-1" },
      organization: { id: "org-1", slug: "acme-bau", displayName: "Acme Bau", role: "owner" },
    });
    expect(eqCalls).toContainEqual(["organization_members.user_id", "user-1"]);
    expect(eqCalls).toContainEqual(["organization_members.organizations.slug", "acme-bau"]);
  });

  it("sends a visitor without a session to log in", async () => {
    claimsMock.mockResolvedValue({ data: null });
    await expect(requireOrgRole("en", "acme-bau", "member")).rejects.toThrow("REDIRECT:/en/login?next=");
  });

  it("gives a user who belongs to no such organization the forbidden page, as for an unknown slug", async () => {
    membershipMock.mockResolvedValue({ data: null, error: null });
    await expect(requireOrgRole("en", "other-org", "member")).rejects.toThrow("REDIRECT:/en/forbidden");
  });

  it("gives a member the forbidden page where an admin is needed, before any two-step prompt", async () => {
    membershipMock.mockResolvedValue(membership("member"));
    claimsMock.mockResolvedValue({ data: { claims: { sub: "user-1", aal: "aal1" } } });
    await expect(requireOrgRole("en", "acme-bau", "admin")).rejects.toThrow("REDIRECT:/en/forbidden");
  });

  it.each(["owner", "admin"] as const)("holds an %s at aal1 at the MFA page and remembers the page asked for", async (role) => {
    membershipMock.mockResolvedValue(membership(role));
    claimsMock.mockResolvedValue({ data: { claims: { sub: "user-1", aal: "aal1" } } });
    await expect(requireOrgRole("en", "acme-bau", "member")).rejects.toThrow(
      `REDIRECT:/en/mfa?next=${encodeURIComponent("/en/org/acme-bau/members")}`,
    );
  });

  it("lets an owner or admin at aal2 in, and a plain member at aal1 without any two-step prompt", async () => {
    membershipMock.mockResolvedValue(membership("admin"));
    await expect(requireOrgRole("en", "acme-bau", "admin")).resolves.toMatchObject({ organization: { role: "admin" } });
    membershipMock.mockResolvedValue(membership("member"));
    claimsMock.mockResolvedValue({ data: { claims: { sub: "user-1", aal: "aal1" } } });
    await expect(requireOrgRole("en", "acme-bau", "member")).resolves.toMatchObject({ organization: { role: "member" } });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("holds back the two-step prompt for a page that is not gated, such as the vacancy pages", async () => {
    membershipMock.mockResolvedValue(membership("owner"));
    claimsMock.mockResolvedValue({ data: { claims: { sub: "user-1", aal: "aal1" } } });
    await expect(requireOrgRole("en", "acme-bau", "member", { mfa: false })).resolves.toMatchObject({
      organization: { role: "owner" },
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("answers a stranger with not found, not forbidden, when the page hides its organization", async () => {
    membershipMock.mockResolvedValue({ data: null, error: null });
    await expect(requireOrgRole("en", "other-org", "member", { hideFromOutsiders: true })).rejects.toThrow("NOT_FOUND");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("still gives a member the forbidden page where an admin is needed, even when outsiders get not found", async () => {
    membershipMock.mockResolvedValue(membership("member"));
    await expect(requireOrgRole("en", "acme-bau", "admin", { hideFromOutsiders: true })).rejects.toThrow(
      "REDIRECT:/en/forbidden",
    );
  });

  it("fails loudly when the membership cannot be read, rather than treating the user as a stranger", async () => {
    membershipMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(requireOrgRole("en", "acme-bau", "member")).rejects.toThrow("The organization role could not be loaded");
  });
});
