import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

let rpcResult: Result = { data: null, error: null };
let rows: Result = { data: [], error: null };
const calls: unknown[][] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: unknown) => {
      calls.push(["rpc", name, args]);
      const result = Promise.resolve(rpcResult);
      return Object.assign(result, { single: () => Promise.resolve({ data: (rpcResult.data as unknown[] | null)?.[0], error: rpcResult.error }) });
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "in", "order", "limit", "neq", "eq"]) {
        chain[method] = (...args: unknown[]) => {
          calls.push([`${table}.${method}`, ...args]);
          return chain;
        };
      }
      chain.maybeSingle = () => Promise.resolve({ data: (rows.data as unknown[] | null)?.[0] ?? null, error: rows.error });
      chain.then = (resolve: (value: Result) => unknown) => Promise.resolve(rows).then(resolve);
      return chain;
    },
  }),
}));

const { applyToJob, getApplicationStates, getApplyDocuments, getApplyOccupation, getMyApplication, listMyApplications, listTimeline } = await import(
  "@/lib/dal/applications"
);

const jobId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const applicationId = "0a1b2c3d-0000-4000-8000-000000000001";

beforeEach(() => {
  calls.length = 0;
  rpcResult = { data: null, error: null };
  rows = { data: [], error: null };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("applyToJob", () => {
  it("sends the vacancy, the note and the documents and reports a created application", async () => {
    rpcResult = { data: [{ application_id: applicationId, outcome: "created" }], error: null };
    expect(await applyToJob(jobId, "My note", ["d1"])).toEqual({ kind: "created", applicationId });
    expect(calls).toEqual([["rpc", "apply_to_job", { p_job_id: jobId, p_note: "My note", p_document_ids: ["d1"] }]]);
  });

  it("sends no note when there is none", async () => {
    rpcResult = { data: [{ application_id: applicationId, outcome: "created" }], error: null };
    await applyToJob(jobId, null, []);
    expect(calls[0]).toEqual(["rpc", "apply_to_job", { p_job_id: jobId, p_note: undefined, p_document_ids: [] }]);
  });

  it("reports the existing application of a repeated call as existing, without an error", async () => {
    rpcResult = { data: [{ application_id: applicationId, outcome: "existing" }], error: null };
    expect(await applyToJob(jobId, null, [])).toEqual({ kind: "existing", applicationId });
  });

  it("maps a unique violation at the index to the existing application and exposes no SQL text", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "job_applications_one_active_per_job_worker"',
        details: "Key (job_id, worker_user_id)=(x, y) already exists.",
      },
    };
    rows = { data: [{ id: applicationId, job_id: jobId, status: "applied", created_at: "2026-10-07T10:00:00Z" }], error: null };
    const result = await applyToJob(jobId, null, []);
    expect(result).toEqual({ kind: "existing", applicationId });
    expect(JSON.stringify(result)).not.toMatch(/duplicate|index|job_applications|Key/);
  });

  it("does not treat a unique violation as an existing application when none is found", async () => {
    rpcResult = { data: null, error: { code: "23505", message: "duplicate key value", details: "" } };
    expect(await applyToJob(jobId, null, [])).toEqual({ kind: "failed" });
  });

  it.each([
    ["CHARA_JOB_NOT_OPEN", "", { kind: "not_open" }],
    ["CHARA_RATE_LIMITED", "", { kind: "rate_limited" }],
    ["CHARA_NOT_FOUND", "", { kind: "document_not_found" }],
    ["CHARA_FORBIDDEN", "account_not_active", { kind: "forbidden" }],
    ["CHARA_PROFILE_INCOMPLETE", "current_country, occupation_id", { kind: "profile_incomplete", missing: ["current_country", "occupation_id"] }],
  ])("maps %s to a refusal that carries no database text", async (message, details, expected) => {
    rpcResult = { data: null, error: { code: "P0001", message, details } };
    expect(await applyToJob(jobId, null, [])).toEqual(expected);
  });

  it("answers an unknown error as failed and logs only its code and message", async () => {
    rpcResult = { data: null, error: { code: "XX000", message: "connection to server lost", details: "secret detail" } };
    expect(await applyToJob(jobId, null, [])).toEqual({ kind: "failed" });
    expect(console.error).toHaveBeenCalledWith("Apply to vacancy failed", { code: "XX000", message: "connection to server lost" });
  });
});

describe("getApplyOccupation", () => {
  it("reads the occupation of the candidate's own passport only", async () => {
    rows = { data: [{ occupation_id: "7212" }], error: null };
    expect(await getApplyOccupation("user-1")).toEqual({ occupationId: "7212" });
    expect(calls).toEqual([["worker_profiles.select", "occupation_id"], ["worker_profiles.eq", "user_id", "user-1"]]);
  });

  it("tells a passport without an occupation from no passport", async () => {
    rows = { data: [{ occupation_id: null }], error: null };
    expect(await getApplyOccupation("user-1")).toEqual({ occupationId: null });
    rows = { data: [], error: null };
    expect(await getApplyOccupation("user-1")).toBeNull();
  });

  it("fails loudly when the read fails", async () => {
    rows = { data: null, error: { message: "boom" } };
    await expect(getApplyOccupation("user-1")).rejects.toThrow("The passport could not be loaded");
  });
});

describe("getApplicationStates", () => {
  const row = (id: string, status: string, createdAt: string, job = jobId) => ({ id, job_id: job, status, created_at: createdAt });

  it("reads nothing for no vacancy", async () => {
    expect(await getApplicationStates([])).toEqual(new Map());
    expect(calls).toEqual([]);
  });

  it("prefers the non-withdrawn application over a newer withdrawn one", async () => {
    rows = { data: [row("w2", "withdrawn", "2026-10-06T10:00:00Z"), row("a1", "interview", "2026-10-03T10:00:00Z")], error: null };
    expect(await getApplicationStates([jobId])).toEqual(new Map([[jobId, { id: "a1", status: "interview", createdAt: "2026-10-03T10:00:00Z" }]]));
  });

  it("falls back to the latest withdrawn application", async () => {
    rows = { data: [row("w2", "withdrawn", "2026-10-06T10:00:00Z"), row("w1", "withdrawn", "2026-10-03T10:00:00Z")], error: null };
    expect((await getApplicationStates([jobId])).get(jobId)?.id).toBe("w2");
  });

  it("keeps each vacancy apart and reads them with one query", async () => {
    const other = "0a1b2c3d-0000-4000-8000-0000000000bb";
    rows = { data: [row("a", "applied", "2026-10-06T10:00:00Z"), row("b", "offer", "2026-10-05T10:00:00Z", other)], error: null };
    const states = await getApplicationStates([jobId, other]);
    expect([...states.keys()]).toEqual([jobId, other]);
    expect(calls.filter(([method]) => method === "job_applications.in")).toHaveLength(1);
  });

  it("throws on a failed read, so a page shows its error state", async () => {
    rows = { data: null, error: { message: "boom" } };
    await expect(getApplicationStates([jobId])).rejects.toThrow("The applications could not be loaded");
  });
});

describe("the candidate's reads", () => {
  it("offers the own documents that did not fail their check, newest first", async () => {
    rows = { data: [{ id: "d1", title: "CV.pdf", type: "cv" }], error: null };
    expect(await getApplyDocuments()).toEqual([{ id: "d1", title: "CV.pdf", type: "cv" }]);
    expect(calls).toContainEqual(["worker_documents.neq", "scan_status", "rejected"]);
    expect(calls).toContainEqual(["worker_documents.limit", 100]);
  });

  it("asks for a page of 20 applications and one more, at the offset of the page, with no stage by default", async () => {
    rpcResult = { data: [], error: null };
    await listMyApplications(null, 3);
    expect(calls).toEqual([["rpc", "my_applications", { p_stage: undefined, p_limit: 21, p_offset: 40 }]]);
  });

  it("passes the stage on to the function", async () => {
    rpcResult = { data: [], error: null };
    await listMyApplications("interview", 1);
    expect(calls).toEqual([["rpc", "my_applications", { p_stage: "interview", p_limit: 21, p_offset: 0 }]]);
  });

  it("maps the rows of the list without the vacancy state and says there is a next page only for a 21st row", async () => {
    const row = (n: number) => ({
      id: `a${n}`, job_title: "Welder", employer_display_name: "Acme", job_status: "paused", moderation_state: "visible",
      status: "rejected", applied_at: "2026-10-03T10:00:00Z", last_event_at: "2026-10-05T10:00:00Z",
    });
    rpcResult = { data: Array.from({ length: 21 }, (_, n) => row(n)), error: null };
    const full = await listMyApplications(null, 1);
    expect(full.hasNext).toBe(true);
    expect(full.applications).toHaveLength(20);
    expect(full.applications[0]).toEqual({
      id: "a0", jobTitle: "Welder", employerName: "Acme", status: "rejected", appliedAt: "2026-10-03T10:00:00Z", lastEventAt: "2026-10-05T10:00:00Z",
    });
    rpcResult = { data: Array.from({ length: 20 }, (_, n) => row(n)), error: null };
    expect((await listMyApplications(null, 2)).hasNext).toBe(false);
  });

  it("throws when the list cannot be read, with no database text in the message", async () => {
    rpcResult = { data: null, error: { message: "permission denied for function my_applications" } };
    await expect(listMyApplications(null, 1)).rejects.toThrow("The applications could not be loaded");
  });

  it("gives null for an application the function does not return", async () => {
    rpcResult = { data: [], error: null };
    expect(await getMyApplication(applicationId)).toBeNull();
  });

  it("maps the application with whether its vacancy can still be opened", async () => {
    rpcResult = {
      data: [{ id: applicationId, job_id: jobId, job_title: "Welder", employer_display_name: "Acme", vacancy_is_open: false, status: "applied", cover_note: null, applied_at: "2026-10-03T10:00:00Z" }],
      error: null,
    };
    expect(await getMyApplication(applicationId)).toEqual({
      id: applicationId, jobId, jobTitle: "Welder", employerName: "Acme", status: "applied", appliedAt: "2026-10-03T10:00:00Z", vacancyIsOpen: false, coverNote: null,
    });
  });

  it("reads the timeline from the view, without an id or an actor id, with the note and who acted", async () => {
    rows = {
      data: [
        { created_at: "2026-10-03T10:00:00Z", to_status: "applied", note: null, actor_role: "you" },
        { created_at: "2026-10-04T10:00:00Z", to_status: "rejected", note: "Position filled", actor_role: "employer" },
      ],
      error: null,
    };
    expect(await listTimeline(applicationId)).toEqual([
      { toStatus: "applied", note: null, createdAt: "2026-10-03T10:00:00Z", actorRole: "you" },
      { toStatus: "rejected", note: "Position filled", createdAt: "2026-10-04T10:00:00Z", actorRole: "employer" },
    ]);
    expect(calls).toContainEqual(["v_my_application_timeline.select", "created_at, to_status, note, actor_role"]);
    expect(calls).toContainEqual(["v_my_application_timeline.eq", "application_id", applicationId]);
  });

  it("refuses a timeline row whose columns are null instead of showing it", async () => {
    rows = { data: [{ created_at: null, to_status: null, note: null, actor_role: null }], error: null };
    await expect(listTimeline(applicationId)).rejects.toThrow();
  });
});
