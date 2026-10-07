import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [method: string, ...args: unknown[]];

const calls: Call[] = [];
let result: { data: unknown; error: unknown } = { data: null, error: null };

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "in"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([`${table}.${method}`, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: builder,
    rpc: (name: string, args: unknown) => {
      calls.push([`rpc.${name}`, args]);
      return Promise.resolve(result);
    },
  }),
}));

const { getSavedJobIds, listSavedJobs } = await import("@/lib/dal/saved-jobs");

const first = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const second = "0a1b2c3d-0000-4000-8000-000000000002";
const third = "0a1b2c3d-0000-4000-8000-000000000003";

const row = (overrides: Record<string, unknown>) => ({
  job_id: first,
  saved_at: "2026-10-06T10:00:00.123456+00:00",
  available: true,
  status: "open",
  title: "Welder MIG/MAG",
  employer_display_name: "Acme Bau",
  next_cursor: null,
  ...overrides,
});

beforeEach(() => {
  calls.length = 0;
  result = { data: null, error: null };
});

describe("listSavedJobs", () => {
  it("asks for one page of the size of the criteria and passes the cursor on", async () => {
    result = { data: [], error: null };
    await listSavedJobs("2026-10-06T10:00:00.123456Z|x");
    expect(calls).toEqual([["rpc.list_saved_jobs", { p_cursor: "2026-10-06T10:00:00.123456Z|x", p_limit: 20 }]]);
  });

  it("sends no cursor for the first page", async () => {
    result = { data: [], error: null };
    await listSavedJobs(null);
    expect(calls).toEqual([["rpc.list_saved_jobs", { p_cursor: undefined, p_limit: 20 }]]);
  });

  it("maps a visible vacancy to its title, employer and status", async () => {
    result = {
      data: [row({}), row({ job_id: second, status: "closed", title: "Closed one" })],
      error: null,
    };
    const { jobs, nextCursor } = await listSavedJobs(null);
    expect(jobs).toEqual([
      { id: first, savedAt: "2026-10-06T10:00:00.123456+00:00", available: true, status: "open", title: "Welder MIG/MAG", employerName: "Acme Bau" },
      { id: second, savedAt: "2026-10-06T10:00:00.123456+00:00", available: true, status: "closed", title: "Closed one", employerName: "Acme Bau" },
    ]);
    expect(nextCursor).toBeNull();
  });

  it("maps a withdrawn vacancy to its id and the unavailable flag only, whatever else the row holds", async () => {
    result = {
      data: [row({ available: false, status: null, title: null, employer_display_name: null, next_cursor: "c" })],
      error: null,
    };
    const { jobs, nextCursor } = await listSavedJobs(null);
    expect(jobs).toEqual([{ id: first, savedAt: "2026-10-06T10:00:00.123456+00:00", available: false }]);
    expect(nextCursor).toBe("c");
  });

  it("shows no title or employer for a row that is flagged available but is missing them", async () => {
    result = { data: [row({ title: null }), row({ job_id: second, employer_display_name: null }), row({ job_id: third, status: "draft" })], error: null };
    const { jobs } = await listSavedJobs(null);
    expect(jobs.map((job) => job.available)).toEqual([false, false, false]);
    expect(JSON.stringify(jobs)).not.toContain("Acme");
  });

  it("takes the cursor from the last row of the page", async () => {
    result = { data: [row({}), row({ job_id: second, next_cursor: "next" })], error: null };
    expect((await listSavedJobs(null)).nextCursor).toBe("next");
  });

  it("throws on a failed read, without the database's words", async () => {
    result = { data: null, error: { message: "boom: relation saved_jobs" } };
    await expect(listSavedJobs(null)).rejects.toThrow("The saved vacancies could not be loaded");
    await expect(listSavedJobs(null)).rejects.not.toThrow(/boom/);
  });
});

describe("getSavedJobIds", () => {
  it("reads the saved rows among the given vacancies in one query", async () => {
    result = { data: [{ job_id: second }], error: null };
    const saved = await getSavedJobIds([first, second, third]);
    expect(calls).toEqual([["saved_jobs.select", "job_id"], ["saved_jobs.in", "job_id", [first, second, third]]]);
    expect([...saved]).toEqual([second]);
  });

  it("asks nothing for no vacancies", async () => {
    expect((await getSavedJobIds([])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("throws on a failed read", async () => {
    result = { data: null, error: { message: "x" } };
    await expect(getSavedJobIds([first])).rejects.toThrow("The saved vacancies could not be loaded");
  });
});
