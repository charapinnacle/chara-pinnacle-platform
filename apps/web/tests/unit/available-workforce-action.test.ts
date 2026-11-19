import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const releasedMock = vi.hoisted(() => vi.fn());
const logFaultMock = vi.hoisted(() => vi.fn(() => "ref-1"));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/fault", () => ({ logFault: logFaultMock, faultMessage: (reference: string) => `Something went wrong (${reference})` }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { searchAvailableWorkforce } = await import("@/lib/actions/available-workforce");

const input = { occupation: "7212", destination: "de", workers: "100", within_days: "60" };
const UNAVAILABLE = { failure: "The available workforce cannot be searched at the moment." };

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  rpcMock.mockResolvedValue({ data: [], error: null });
});

// FR-K3 step Search: the action behind the Available workforce search.
describe("searchAvailableWorkforce", () => {
  it("sends the checked values and returns a page", async () => {
    await expect(searchAvailableWorkforce(input, null)).resolves.toEqual({ page: { suppliers: [], nextCursor: null } });
    expect(rpcMock).toHaveBeenCalledWith("search_available_workforce", {
      p_destination: "DE",
      p_occupation: "7212",
      p_workers_needed: 100,
      p_within_days: 60,
      p_cursor: undefined,
    });
  });

  it("returns field errors and sends nothing for invalid values or while release 2a is off", async () => {
    await expect(searchAvailableWorkforce({ ...input, workers: "0" }, null)).resolves.toMatchObject({ errors: { workers: expect.any(String) } });
    releasedMock.mockResolvedValue(false);
    await expect(searchAvailableWorkforce(input, null)).resolves.toEqual(UNAVAILABLE);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("explains the plan and the search limit", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_FEATURE_NOT_IN_PLAN", code: "P0001" } });
    await expect(searchAvailableWorkforce(input, null)).resolves.toEqual({ refused: "not_in_plan" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_RATE_LIMITED", code: "P0001" } });
    await expect(searchAvailableWorkforce(input, null)).resolves.toEqual({ refused: "rate_limited" });
  });

  it.each([
    ["a caller without an employer organisation", { message: "CHARA_FORBIDDEN", code: "42501" }],
    ["a visitor refused at the grant", { message: "permission denied for function search_available_workforce", code: "42501" }],
    ["the release switched off", { message: "CHARA_NOT_FOUND", code: "P0002" }],
  ])("answers %s as unavailable without logging a fault", async (_, error) => {
    rpcMock.mockResolvedValueOnce({ data: null, error });
    await expect(searchAvailableWorkforce(input, null)).resolves.toEqual(UNAVAILABLE);
    expect(logFaultMock).not.toHaveBeenCalled();
  });

  it("logs any other error as a fault", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom", code: "XX000" } });
    await expect(searchAvailableWorkforce(input, null)).resolves.toEqual({ failure: "Something went wrong (ref-1)" });
    expect(logFaultMock).toHaveBeenCalledOnce();
  });
});
