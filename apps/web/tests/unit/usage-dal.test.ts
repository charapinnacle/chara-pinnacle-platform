import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const plansMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));
vi.mock("@/lib/dal/pricing", () => ({ listPublicPlans: plansMock }));

const { getOrgUsage, getUsagePrompts } = await import("@/lib/dal/usage");

const row = (limit_key: string, used: number, limit_value: number | null, applies = true, period_resets_at: string | null = null) => ({
  limit_key,
  used,
  limit_value,
  applies,
  period_resets_at,
  plan_name: "Basic",
});

beforeEach(() => {
  vi.clearAllMocks();
  plansMock.mockResolvedValue([
    { code: "staffing_professional", name: "Professional", priceMinor: 12900, currency: "EUR", interval: "month", trialDays: 30, contactSales: false, limits: { markets: 10 }, features: [] },
  ]);
});

describe("getOrgUsage (FR-R1)", () => {
  it("reads org_usage for the organisation and keys the rows by limit", async () => {
    rpcMock.mockResolvedValue({ data: [row("markets", 2, 3), row("messages_per_month", 0, 100, true, "2026-12-01T00:00:00+00:00")], error: null });
    expect(await getOrgUsage("org-1", ["markets", "messages_per_month"])).toEqual({
      planName: "Basic",
      items: {
        markets: { used: 2, limit: 3, applies: true, resetsAt: null },
        messages_per_month: { used: 0, limit: 100, applies: true, resetsAt: "2026-12-01T00:00:00+00:00" },
      },
    });
    expect(rpcMock).toHaveBeenCalledWith("org_usage", { p_org: "org-1", p_keys: ["markets", "messages_per_month"] });
  });

  it("fails without the cause in the message when the database refuses, and on an answer of another shape", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: "release_off" } });
    await expect(getOrgUsage("org-1", ["markets"])).rejects.toThrow("The usage of the organisation could not be loaded");
    rpcMock.mockResolvedValue({ data: [{ ...row("markets", 2, 3), used: "2" }], error: null });
    await expect(getOrgUsage("org-1", ["markets"])).rejects.toThrow();
  });
});

describe("getUsagePrompts (FR-R1)", () => {
  it("gives a partner the prompts of the limits that apply, with the plans of its type compared", async () => {
    rpcMock.mockResolvedValue({ data: [row("markets", 3, 3), row("listed_occupations", 4, 10, false)], error: null });
    expect(await getUsagePrompts("org-1", "staffing_company", ["markets", "listed_occupations", "workforce_listings"])).toEqual({
      markets: { limitKey: "markets", used: 3, limit: 3, resetsAt: null, planName: "Basic", comparison: "Professional includes 10 countries served." },
      listed_occupations: null,
      workforce_listings: null,
    });
    expect(plansMock).toHaveBeenCalledWith("staffing_company");
    expect(rpcMock).toHaveBeenCalledWith("org_usage", {
      p_org: "org-1",
      p_keys: ["markets", "listed_occupations", "workforce_listings"],
    });
  });

  it("reads no plans for an employer, whose prompt links to the billing page", async () => {
    rpcMock.mockResolvedValue({ data: [row("members", 1, 1)], error: null });
    expect((await getUsagePrompts("org-1", "employer", ["members"])).members?.comparison).toBeNull();
    expect(plansMock).not.toHaveBeenCalled();
  });
});
