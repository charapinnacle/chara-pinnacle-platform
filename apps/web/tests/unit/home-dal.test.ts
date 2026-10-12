import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const logSearch = vi.hoisted(() => vi.fn());
const eqCalls: [string, string][] = [];
const selectCalls: unknown[][] = [];
let countError: { code: string } | null = null;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: <Read>(read: Read) => read }));
vi.mock("@/lib/supabase/anonymous", () => ({ anonymousClient: () => ({ rpc, from }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/jobs/search-log", () => ({ logSearch }));

const { getIndustryCounts, getNewestJobs } = await import("@/lib/dal/home");

const row = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Welder",
  employer_display_name: "Employer",
  employer_slug: "employer",
  country_code: "DE",
  city: "Hamburg",
  employment_type: "full_time",
  salary_min: 3200,
  salary_max: 3900,
  salary_currency: "EUR",
  salary_period: "month",
  accommodation: false,
  visa_support: true,
  recruitment_preference: "both",
  created_at: "2026-10-03T08:00:00Z",
  next_cursor: null,
};

beforeEach(() => {
  eqCalls.length = 0;
  selectCalls.length = 0;
  countError = null;
  from.mockImplementation(() => ({
    select: (...args: unknown[]) => {
      selectCalls.push(args);
      return {
        eq: (column: string, value: string) => {
          eqCalls.push([column, value]);
          return Promise.resolve(countError ? { count: null, error: countError } : { count: value.charCodeAt(0), error: null });
        },
      };
    },
  }));
});

afterEach(() => vi.restoreAllMocks());

describe("the newest vacancies of the home page", () => {
  it("read one page of 50 of the public search without filters, map it as the search does and write nothing to the search log", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    expect(await getNewestJobs()).toEqual([
      {
        id: row.id,
        title: "Welder",
        employerName: "Employer",
        countryCode: "DE",
        city: "Hamburg",
        employmentType: "full_time",
        salaryMin: 3200,
        salaryMax: 3900,
        salaryCurrency: "EUR",
        salaryPeriod: "month",
        accommodation: false,
        visaSupport: true,
        createdAt: "2026-10-03T08:00:00Z",
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("search_jobs", { p_limit: 50 });
    expect(logSearch).not.toHaveBeenCalled();
  });

  it("are null, and the code goes to the log, when the search fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(await getNewestJobs()).toBeNull();
    expect(log).toHaveBeenCalledWith("The newest vacancies of the home page could not be loaded", { code: "42501", message: "permission denied" });
  });
});

describe("the industry counts of the home page", () => {
  it("count the open vacancies of each industry with a head request, one per code", async () => {
    expect(await getIndustryCounts(["F", "Q"])).toEqual({ F: 70, Q: 81 });
    expect(from).toHaveBeenCalledWith("jobs");
    expect(selectCalls).toEqual([
      ["id", { count: "exact", head: true }],
      ["id", { count: "exact", head: true }],
    ]);
    expect(eqCalls).toEqual([
      ["industry_code", "F"],
      ["industry_code", "Q"],
    ]);
  });

  it("are null when a count fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    countError = { code: "57014" };
    expect(await getIndustryCounts(["F"])).toBeNull();
  });
});
