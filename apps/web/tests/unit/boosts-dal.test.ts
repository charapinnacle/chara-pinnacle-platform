import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const requestMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock, from: fromMock }) }));
vi.mock("@/lib/dal/billing", () => ({ requestHostedSession: requestMock }));

const { getBoostedPartners, getBoostStatus, listBoostProducts, requestBoostCheckout } = await import("@/lib/dal/boosts");

const ORG = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

// A query builder whose every step returns itself and which resolves to the given answer.
function query(answer: { data: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order"]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(answer).then(resolve);
  return { builder, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getBoostedPartners", () => {
  it("passes the filters of the directory search, without the cursor, and reads the cards", async () => {
    rpcMock.mockResolvedValue({
      data: [{
        id: ORG,
        slug: "manila-welders",
        display_name: "Manila Welders",
        organization_type: "recruitment_company",
        based_in_country: "PH",
        served_countries: [{ code: "DE", name: "Germany" }],
        main_occupations: [{ code: "7212", name: "Welders and flame cutters" }],
        staffing_types: [],
      }],
      error: null,
    });
    const partners = await getBoostedPartners("recruitment", { occupation: "7212", destination: "DE", cursor: "1|x|y", limit: 20 });
    expect(rpcMock).toHaveBeenCalledWith("boosted_partners", expect.objectContaining({
      p_kind: "recruitment",
      p_occupation: "7212",
      p_destination: "DE",
    }));
    expect(Object.keys(rpcMock.mock.calls[0][1])).not.toContain("p_cursor");
    expect(partners).toEqual([{
      id: ORG,
      slug: "manila-welders",
      displayName: "Manila Welders",
      basedInCountry: "PH",
      servedCountries: [{ code: "DE", name: "Germany" }],
      mainOccupations: [{ code: "7212", name: "Welders and flame cutters" }],
      staffingTypes: [],
    }]);
  });

  it("throws when the database refuses", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(getBoostedPartners("staffing", { limit: 20 })).rejects.toThrow("The boosted partners could not be loaded");
  });
});

describe("listBoostProducts", () => {
  it("reads the profile boosts of the organisation's type in their order", async () => {
    const { builder, calls } = query({
      data: [{ sku: "boost_staffing_7d", days: 7, price_minor: 4900, currency: "EUR" }],
      error: null,
    });
    fromMock.mockReturnValue(builder);
    expect(await listBoostProducts("staffing_company")).toEqual([
      { sku: "boost_staffing_7d", days: 7, priceMinor: 4900, currency: "EUR" },
    ]);
    expect(fromMock).toHaveBeenCalledWith("v_boost_products");
    expect(calls).toContainEqual(["eq", ["org_type", "staffing_company"]]);
    expect(calls).toContainEqual(["eq", ["target_type", "organization"]]);
  });
});

describe("getBoostStatus", () => {
  const now = new Date("2026-11-28T10:00:00Z");

  it("is null without a boost that has not ended", async () => {
    fromMock.mockReturnValue(query({ data: [], error: null }).builder);
    expect(await getBoostStatus(ORG, now)).toBeNull();
  });

  it("gives the end of the last boost bought, and whether one runs now", async () => {
    fromMock.mockReturnValue(query({
      data: [
        { starts_at: "2026-11-20T10:00:00Z", ends_at: "2026-12-04T10:00:00Z" },
        { starts_at: "2026-12-04T10:00:00Z", ends_at: "2026-12-11T10:00:00Z" },
      ],
      error: null,
    }).builder);
    expect(await getBoostStatus(ORG, now)).toEqual({ running: true, endsAt: "2026-12-11T10:00:00Z" });
  });

  it("is paid but not running when the only boost starts later", async () => {
    fromMock.mockReturnValue(query({
      data: [{ starts_at: "2026-11-29T10:00:00Z", ends_at: "2026-12-06T10:00:00Z" }],
      error: null,
    }).builder);
    expect(await getBoostStatus(ORG, now)).toEqual({ running: false, endsAt: "2026-12-06T10:00:00Z" });
  });
});

describe("requestBoostCheckout", () => {
  it("asks billing-checkout for the boost action with the organisation and the product only", async () => {
    requestMock.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_boost" });
    await requestBoostCheckout(ORG, "boost_recruitment_14d");
    expect(requestMock).toHaveBeenCalledWith({ action: "boost", orgId: ORG, sku: "boost_recruitment_14d" });
  });
});
