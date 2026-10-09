import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [method: string, ...args: unknown[]];

const calls: Call[] = [];
let result: { data: unknown; error: unknown } = { data: null, error: null };
let user: { id: string; accountKind: string | null } | null = null;
let organizations: { slug: string; role: "owner" | "admin" | "member" }[] = [];

function builder() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      calls.push(["from", table]);
      return builder();
    },
  }),
}));
vi.mock("@/lib/dal/session", () => ({
  getCurrentUser: async () => user,
  roleRank: { member: 1, admin: 2, owner: 3 },
}));
vi.mock("@/lib/dal/organizations", () => ({ getMyOrganizations: async () => organizations }));

const { getPricingViewer, listPublicPlans } = await import("@/lib/dal/pricing");

const row = (overrides: Record<string, unknown> = {}) => ({
  code: "employer_starter",
  name: "Basic",
  price_minor: 3900,
  currency: "EUR",
  interval: "month",
  trial_days: 30,
  contact_sales: false,
  limits: { active_jobs: 3, members: 1 },
  features: ["shortlisting"],
  ...overrides,
});

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null };
  user = null;
  organizations = [];
});

describe("the plans of the pricing page (FR-H2 AC1, AC5)", () => {
  it("reads the public employer plans in display order, bounded, from the view", async () => {
    result = { data: [row(), row({ code: "employer_professional", name: "Professional", price_minor: 7900 })], error: null };

    const plans = await listPublicPlans();

    expect(plans.map((plan) => [plan.code, plan.name, plan.priceMinor])).toEqual([
      ["employer_starter", "Basic", 3900],
      ["employer_professional", "Professional", 7900],
    ]);
    expect(calls).toContainEqual(["from", "v_plans"]);
    expect(calls).toContainEqual(["eq", "is_public", true]);
    expect(calls).toContainEqual(["eq", "org_type", "employer"]);
    expect(calls).toContainEqual(["order", "sort"]);
    expect(calls).toContainEqual(["limit", 20]);
  });

  it("returns an empty list when no plan is public", async () => {
    expect(await listPublicPlans()).toEqual([]);
  });

  it("throws when the read fails, so that the error page shows and no price is guessed (FR-H2 AC11)", async () => {
    result = { data: null, error: { message: "permission denied for view v_plans" } };
    await expect(listPublicPlans()).rejects.toThrow("The plans could not be loaded");
  });

  it("throws on a row that is not a plan", async () => {
    result = { data: [row({ price_minor: "39" })], error: null };
    await expect(listPublicPlans()).rejects.toThrow();
  });
});

describe("who reads the page (FR-H2 AC12)", () => {
  it("is a visitor without a session", async () => {
    expect(await getPricingViewer()).toEqual({ kind: "visitor" });
  });

  it("is a worker for a candidate account", async () => {
    user = { id: "u1", accountKind: "worker" };
    expect(await getPricingViewer()).toEqual({ kind: "worker" });
  });

  it("is still setting up while the kind of account is not committed or no organisation exists", async () => {
    user = { id: "u1", accountKind: null };
    expect(await getPricingViewer()).toEqual({ kind: "setup" });
    user = { id: "u1", accountKind: "company" };
    expect(await getPricingViewer()).toEqual({ kind: "setup" });
  });

  it("is a manager of the first organisation that the person owns or administers", async () => {
    user = { id: "u1", accountKind: "company" };
    organizations = [
      { slug: "joined", role: "member" },
      { slug: "administered", role: "admin" },
      { slug: "owned", role: "owner" },
    ];
    expect(await getPricingViewer()).toEqual({ kind: "manager", slug: "administered" });
  });

  it("is a member when the person has no more than the member role anywhere", async () => {
    user = { id: "u1", accountKind: "company" };
    organizations = [{ slug: "joined", role: "member" }];
    expect(await getPricingViewer()).toEqual({ kind: "member" });
  });
});
