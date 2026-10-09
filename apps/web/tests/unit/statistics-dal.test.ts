import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code: string; message: string } | null };

let result: Result = { data: null, error: null };
const from = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));

const { getPlatformStatistics } = await import("@/lib/dal/statistics");

beforeEach(() => {
  from.mockReturnValue({ select });
  select.mockReturnValue({ single: () => Promise.resolve(result) });
});

afterEach(() => vi.restoreAllMocks());

describe("getPlatformStatistics (FR-H4 AC12)", () => {
  it("reads the four columns of the public view and returns a tile for each value that is not null", async () => {
    result = { data: { active_jobs: 15, employers: null, workers: 1230, countries: null }, error: null };
    expect(await getPlatformStatistics()).toEqual([
      { label: "Vacancies", value: "15" },
      { label: "Candidates", value: "1,230" },
    ]);
    expect(from).toHaveBeenCalledWith("v_platform_counts");
    expect(select).toHaveBeenCalledWith("active_jobs, employers, workers, countries");
  });

  it("returns no tile and logs the error code and message when the read fails, without throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    result = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    expect(await getPlatformStatistics()).toEqual([]);
    expect(log).toHaveBeenCalledWith("Platform statistics read failed", {
      code: "57014",
      message: "canceling statement due to statement timeout",
    });
  });
});
