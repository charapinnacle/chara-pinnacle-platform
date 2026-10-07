import { beforeEach, describe, expect, it, vi } from "vitest";
import { pipelineStages } from "@/lib/applications/presentation";
import type { ApplicantListParams } from "@/lib/validation/applicant-list";

type Result = { data: unknown; error: unknown; count?: number | null };
type Call = [string, unknown[]];

let results: Result[] = [];
let rpcResult: Result = { data: null, error: null };
const calls: Call[] = [];
const rpcCalls: unknown[][] = [];

// A query builder that records every call and answers the next prepared result when it is awaited.
function builder(): unknown {
  const self: unknown = new Proxy(
    {},
    {
      get: (_target, name: string) =>
        name === "then"
          ? (resolve: (value: Result) => void) => resolve(results.shift() ?? { data: [], error: null, count: 0 })
          : (...args: unknown[]) => {
              calls.push([name, args]);
              return self;
            },
    },
  );
  return self;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      calls.push(["from", [table]]);
      return builder();
    },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return Promise.resolve(rpcResult);
    },
  }),
}));

const { APPLICANTS_PAGE_SIZE, exportApplicants, getApplicantAccess, getBoardCounts, listApplicants, listBoard } = await import(
  "@/lib/dal/applicant-list"
);

const org = "0a1b2c3d-0000-4000-8000-0000000000aa";
const job = "0a1b2c3d-0000-4000-8000-0000000000bb";
const row = (n: number, status = "applied") => ({
  id: `0a1b2c3d-0000-4000-8000-${String(n).padStart(12, "0")}`,
  job_id: job,
  job_title: "Welder",
  candidate_name: n === 2 ? null : `Cand ${n}`,
  status,
  applied_at: "2026-09-04T10:00:00+00:00",
  completeness: 80,
  documents: 2,
});
const params = (over: Partial<ApplicantListParams> = {}): ApplicantListParams => ({
  job: null, view: "list", sort: "applied", dir: "desc", stage: null, page: 1, ...over,
});
const named = (name: string) => calls.filter(([call]) => call === name).map(([, args]) => args);

beforeEach(() => {
  calls.length = 0;
  rpcCalls.length = 0;
  results = [];
  rpcResult = { data: null, error: null };
});

describe("listApplicants", () => {
  it("reads the view for the organization, newest first, one page of 50, with the count of the whole filter", async () => {
    results = [{ data: [row(1), row(2)], error: null, count: 2 }];
    const page = await listApplicants(org, params());
    expect(named("from")).toEqual([["v_job_applicants"]]);
    expect(named("select")[0][1]).toEqual({ count: "exact" });
    expect(named("eq")).toEqual([["organization_id", org]]);
    expect(named("order")).toEqual([["applied_at", { ascending: false }], ["id", { ascending: false }]]);
    expect(named("range")).toEqual([[0, APPLICANTS_PAGE_SIZE - 1]]);
    expect(page.total).toBe(2);
    expect(page.rows[0]).toEqual({
      id: row(1).id, jobId: job, jobTitle: "Welder", candidateName: "Cand 1", status: "applied",
      appliedAt: "2026-09-04T10:00:00+00:00", completeness: 80, documents: 2,
    });
    expect(page.rows[1].candidateName).toBeNull();
  });

  it("filters by vacancy and stage, and sorts by the column asked, newest first within equal values", async () => {
    results = [{ data: [], error: null, count: 0 }];
    await listApplicants(org, params({ job, stage: "shortlisted", sort: "completeness", dir: "asc", page: 1 }));
    expect(named("eq")).toEqual([["organization_id", org], ["job_id", job], ["status", "shortlisted"]]);
    expect(named("order")).toEqual([["completeness", { ascending: true }], ["applied_at", { ascending: false }], ["id", { ascending: false }]]);
  });

  it.each([["stage", "status"], ["documents", "documents"], ["applied", "applied_at"]] as const)("maps the sort %s to the column %s", async (sort, column) => {
    results = [{ data: [], error: null, count: 0 }];
    await listApplicants(org, params({ sort }));
    expect(named("order")[0][0]).toBe(column);
  });

  it("reads the second page from row 50", async () => {
    results = [{ data: [row(1)], error: null, count: 51 }];
    await listApplicants(org, params({ page: 2 }));
    expect(named("range")).toEqual([[50, 99]]);
  });

  it("shows the last page for a page past the end, whether PostgREST refuses the range or answers no row", async () => {
    results = [{ data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null }, { data: [row(1)], error: null, count: 51 }, { data: [row(1)], error: null, count: 51 }];
    const page = await listApplicants(org, params({ page: 9 }));
    expect(named("range")).toEqual([[400, 449], [0, 49], [50, 99]]);
    expect(page).toMatchObject({ page: 2, total: 51 });
    expect(page.rows).toHaveLength(1);

    calls.length = 0;
    results = [{ data: [], error: null, count: 51 }, { data: [row(1)], error: null, count: 51 }, { data: [row(1)], error: null, count: 51 }];
    expect(await listApplicants(org, params({ page: 9 }))).toMatchObject({ page: 2, total: 51 });
  });

  it("shows the first page of nothing for a page past the end of an empty list", async () => {
    results = [{ data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null }, { data: [], error: null, count: 0 }];
    expect(await listApplicants(org, params({ page: 3 }))).toEqual({ rows: [], total: 0, page: 1 });
    expect(named("range")).toEqual([[100, 149], [0, 49]]);
  });

  it("throws without database text when the read fails", async () => {
    results = [{ data: null, error: { message: "permission denied for view v_job_applicants" }, count: null }];
    await expect(listApplicants(org, params())).rejects.toThrow("The applicants could not be loaded");
  });

  it("refuses a row the view should never return", async () => {
    results = [{ data: [{ ...row(1), status: "hacked" }], error: null, count: 1 }];
    await expect(listApplicants(org, params())).rejects.toThrow();
  });
});

describe("listBoard", () => {
  it("reads every stage of the vacancy on its own, in pipeline order, newest 25 with the count of the stage", async () => {
    results = pipelineStages.map((status, index) => ({ data: [row(index, status)], error: null, count: 40 + index }));
    const columns = await listBoard(org, job);
    expect(columns.map((column) => column.status)).toEqual(pipelineStages);
    expect(columns.map((column) => column.total)).toEqual([40, 41, 42, 43, 44, 45, 46, 47]);
    expect(named("eq").filter(([column]) => column === "status").map(([, value]) => value)).toEqual(pipelineStages);
    expect(named("eq").filter(([column]) => column === "job_id")).toHaveLength(8);
    expect(named("limit")).toEqual(Array(8).fill([25]));
  });

  it("fails as a whole when one column cannot be read", async () => {
    results = [{ data: [], error: null, count: 0 }, { data: null, error: { message: "boom" }, count: null }];
    await expect(listBoard(org, job)).rejects.toThrow("The board could not be loaded");
  });
});

describe("getBoardCounts", () => {
  it("asks for the vacancy and gives every stage a count, 0 for a stage the database left out", async () => {
    rpcResult = { data: [{ status: "interview", total: 2 }, { status: "applied", total: 5 }], error: null };
    expect(await getBoardCounts(job)).toEqual({
      applied: 5, viewed: 0, shortlisted: 0, interview: 2, offer: 0, hired: 0, rejected: 0, withdrawn: 0,
    });
    expect(rpcCalls).toEqual([["get_board_counts", { p_job_id: job }]]);
  });

  it("throws, without the database text, when the read fails", async () => {
    rpcResult = { data: null, error: { message: "permission denied for function get_board_counts" } };
    await expect(getBoardCounts(job)).rejects.toThrow("The board counts could not be loaded");
  });
});

describe("getApplicantAccess", () => {
  it("maps the row and sends only the organization", async () => {
    rpcResult = {
      data: [{ stage_change_blocked: "read_only_free_plan", shortlisting_available: false, csv_export_available: false, note_max_chars: 1000 }],
      error: null,
    };
    expect(await getApplicantAccess(org)).toEqual({ stageChangeBlocked: "read_only_free_plan", shortlistingAvailable: false, csvExportAvailable: false, noteMaxChars: 1000 });
    expect(rpcCalls).toEqual([["get_applicant_access", { p_organization_id: org }]]);
  });

  it("answers null without a row and throws on an error", async () => {
    rpcResult = { data: [], error: null };
    expect(await getApplicantAccess(org)).toBeNull();
    rpcResult = { data: null, error: { message: "boom" } };
    await expect(getApplicantAccess(org)).rejects.toThrow("The applicant access could not be loaded");
  });
});

describe("exportApplicants", () => {
  const exported = { candidate_name: "Ana Silva", status: "applied", applied_at: "2026-09-04T10:00:00+00:00", completeness: 80, documents: 2 };

  it("returns the rows of the filter and sends the vacancy and the stage", async () => {
    rpcResult = { data: [exported], error: null };
    expect(await exportApplicants(job, "shortlisted")).toEqual({
      rows: [{ candidateName: "Ana Silva", status: "applied", appliedAt: "2026-09-04T10:00:00+00:00", completeness: 80, documents: 2 }],
    });
    expect(rpcCalls).toEqual([["export_applicants", { p_job_id: job, p_stage: "shortlisted" }]]);
  });

  it("sends no stage for no filter", async () => {
    rpcResult = { data: [], error: null };
    await exportApplicants(job, null);
    expect(rpcCalls).toEqual([["export_applicants", { p_job_id: job, p_stage: undefined }]]);
  });

  it.each([
    ["CHARA_NOT_FOUND", "not_found"],
    ["CHARA_FEATURE_NOT_IN_PLAN", "not_in_plan"],
    ["CHARA_LIMIT_REACHED", "too_many_rows"],
  ])("maps %s to the refusal %s", async (message, refusal) => {
    rpcResult = { data: null, error: { message, details: "x" } };
    expect(await exportApplicants(job, null)).toEqual({ refusal });
  });

  it("throws, without the database text, on any other error", async () => {
    rpcResult = { data: null, error: { message: "CHARA_SETTING_MISSING", details: "applicant_export_max_rows" } };
    await expect(exportApplicants(job, null)).rejects.toThrow("The applicants could not be exported");
  });
});
