import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const networkStatisticsMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/session", () => ({ requirePlatformRole: requireRoleMock }));
vi.mock("@/lib/dal/admin", () => ({ networkStatistics: networkStatisticsMock }));

const { networkStatisticsAction } = await import("@/lib/actions/admin-statistics");

const query = { from: "2026-03-01", to: "2026-04-30", period: "month" } as const;
const statistics = { counts: [], figures: [], minCount: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["admin"] });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// FR-S2 AC4, AC8, AC9: the data request of the Partner network section.
describe("the partner network statistics action", () => {
  it("asks for the Platform Administrator role and answers the statistics of the range", async () => {
    networkStatisticsMock.mockResolvedValue(statistics);
    expect(await networkStatisticsAction(query)).toEqual({ ok: true, statistics });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["admin"]);
    expect(networkStatisticsMock).toHaveBeenCalledWith(query);
  });

  it("refuses a range the form would refuse, without reading", async () => {
    expect(await networkStatisticsAction({ ...query, from: "2026-05-01" })).toEqual({ ok: false });
    expect(await networkStatisticsAction({ ...query, period: "day" as "month" })).toEqual({ ok: false });
    expect(networkStatisticsMock).not.toHaveBeenCalled();
  });

  it("answers a refusal or failure of the database as not ok and logs only the code of the cause", async () => {
    networkStatisticsMock.mockRejectedValue(new Error("The partner network counts could not be loaded", { cause: { code: "42501", message: "release_off" } }));
    expect(await networkStatisticsAction(query)).toEqual({ ok: false });
    expect(console.error).toHaveBeenCalledWith("The partner network statistics failed", { code: "42501" });
  });

  it("lets the refusal of the role guard through", async () => {
    requireRoleMock.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(networkStatisticsAction(query)).rejects.toThrow("NOT_FOUND");
    expect(networkStatisticsMock).not.toHaveBeenCalled();
  });
});
