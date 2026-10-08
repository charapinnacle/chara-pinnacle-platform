import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

let rpcResult: Result = { data: null, error: null };
let rowsResult: Result = { data: [], error: null };
const calls: unknown[][] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: unknown) => {
      calls.push([name, args]);
      return Promise.resolve(rpcResult);
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        in: (column: string, values: string[]) => {
          calls.push([table, columns, column, values]);
          return Promise.resolve(rowsResult);
        },
      }),
    }),
  }),
}));

const { bulkSetApplicationStatus, getApplicant, listApplicantEvents, markApplicationViewed, setApplicationStatus } = await import("@/lib/dal/applicants");

const id = "0a1b2c3d-0000-4000-8000-000000000001";
const failure = (message: string, details: string | null = null) => ({ code: "P0001", message, details });

beforeEach(() => {
  calls.length = 0;
  rpcResult = { data: null, error: null };
  rowsResult = { data: [], error: null };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getApplicant", () => {
  it("maps the row and sends nothing but the id", async () => {
    rpcResult = {
      data: [
        {
          id, organization_id: "o", job_id: "j", job_title: "Welder", applicant_name: "Amina Okafor", status: "viewed",
          applied_at: "2026-10-01T10:00:00Z", shortlisting_available: true, stage_change_blocked: null, note_max_chars: 1000,
        },
      ],
      error: null,
    };
    expect(await getApplicant(id)).toEqual({
      id, organizationId: "o", jobTitle: "Welder", applicantName: "Amina Okafor", status: "viewed",
      appliedAt: "2026-10-01T10:00:00Z", shortlistingAvailable: true, stageChangeBlocked: null, noteMaxChars: 1000,
    });
    expect(calls).toEqual([["get_applicant", { p_application_id: id }]]);
  });

  it("answers null when the database returns no row, and throws without database text on an error", async () => {
    rpcResult = { data: [], error: null };
    expect(await getApplicant(id)).toBeNull();
    rpcResult = { data: null, error: failure("boom") };
    await expect(getApplicant(id)).rejects.toThrow("The applicant could not be loaded");
  });
});

describe("listApplicantEvents", () => {
  it("maps the events in the order given and carries no actor id", async () => {
    rpcResult = {
      data: [
        { id: 1, from_status: null, to_status: "applied", actor_kind: "candidate", actor_name: null, note: null, created_at: "t1" },
        { id: 2, from_status: "applied", to_status: "viewed", actor_kind: "system", actor_name: null, note: null, created_at: "t2" },
        { id: 3, from_status: "viewed", to_status: "rejected", actor_kind: "employer", actor_name: "Mia", note: "Position filled", created_at: "t3" },
      ],
      error: null,
    };
    const events = await listApplicantEvents(id);
    expect(events.map((event) => [event.id, event.fromStatus, event.toStatus, event.actor, event.actorName, event.note])).toEqual([
      [1, null, "applied", "candidate", null, null],
      [2, "applied", "viewed", "system", null, null],
      [3, "viewed", "rejected", "employer", "Mia", "Position filled"],
    ]);
    expect(Object.keys(events[0])).not.toContain("actorId");
  });
});

describe("markApplicationViewed", () => {
  it("calls the function with the id", async () => {
    await markApplicationViewed(id);
    expect(calls).toEqual([["mark_application_viewed", { p_application_id: id }]]);
  });

  it("treats an application the caller cannot see as nothing to do and any other error as a failure", async () => {
    rpcResult = { data: null, error: failure("CHARA_NOT_FOUND") };
    await expect(markApplicationViewed(id)).resolves.toBeUndefined();
    rpcResult = { data: null, error: failure("CHARA_FORBIDDEN", "company_account_required") };
    await expect(markApplicationViewed(id)).rejects.toThrow("The application could not be marked as viewed");
  });
});

describe("setApplicationStatus", () => {
  it("sends the target and the note, and no note when it is empty", async () => {
    expect(await setApplicationStatus(id, "interview", "Week 41")).toBeNull();
    expect(await setApplicationStatus(id, "offer", "")).toBeNull();
    expect(calls).toEqual([
      ["set_application_status", { p_application_id: id, p_status: "interview", p_note: "Week 41" }],
      ["set_application_status", { p_application_id: id, p_status: "offer", p_note: undefined }],
    ]);
  });

  it.each([
    [failure("CHARA_INVALID_TRANSITION", "rejected to offer"), { kind: "already_moved" }],
    [failure("CHARA_NOT_FOUND"), { kind: "not_found" }],
    [failure("CHARA_FORBIDDEN", "organization_suspended"), { kind: "blocked", reason: "organization_suspended" }],
    [failure("CHARA_FORBIDDEN", "company_account_required"), { kind: "failed" }],
    [failure("CHARA_FEATURE_NOT_IN_PLAN", "read_only_free_plan"), { kind: "blocked", reason: "read_only_free_plan" }],
    [failure("CHARA_FEATURE_NOT_IN_PLAN", "shortlisting"), { kind: "shortlisting_not_in_plan" }],
    [failure("CHARA_INVALID_INPUT", "p_note"), { kind: "note_too_long" }],
    [failure("CHARA_SETTING_MISSING", "share_expiry_days_after_final"), { kind: "failed" }],
    [{ code: "XX000", message: "internal error text", details: null }, { kind: "failed" }],
  ])("maps the error %j to %j", async (error, expected) => {
    rpcResult = { data: null, error };
    expect(await setApplicationStatus(id, "interview", "")).toEqual(expected);
  });
});

describe("bulkSetApplicationStatus", () => {
  const other = "0a1b2c3d-0000-4000-8000-000000000002";

  it("sends the ids, the target and the note, and reads the stage of the refused items only", async () => {
    rpcResult = {
      data: [
        { application_id: id, ok: true, error_code: null },
        { application_id: other, ok: false, error_code: "CHARA_INVALID_TRANSITION" },
      ],
      error: null,
    };
    rowsResult = { data: [{ id: other, status: "applied" }], error: null };
    expect(await bulkSetApplicationStatus([id, other], "offer", "")).toEqual({
      items: [
        { applicationId: id, ok: true, errorCode: null, status: null },
        { applicationId: other, ok: false, errorCode: "CHARA_INVALID_TRANSITION", status: "applied" },
      ],
    });
    expect(calls).toEqual([
      ["bulk_set_application_status", { p_application_ids: [id, other], p_status: "offer", p_note: undefined }],
      ["v_job_applicants", "id, status", "id", [other]],
    ]);
  });

  it("makes no second read when every item was applied", async () => {
    rpcResult = { data: [{ application_id: id, ok: true, error_code: null }], error: null };
    await bulkSetApplicationStatus([id], "rejected", "Position filled");
    expect(calls).toEqual([["bulk_set_application_status", { p_application_ids: [id], p_status: "rejected", p_note: "Position filled" }]]);
  });

  it("keeps the item and leaves its stage unknown when the stage cannot be read", async () => {
    rpcResult = { data: [{ application_id: id, ok: false, error_code: "CHARA_INVALID_TRANSITION" }], error: null };
    rowsResult = { data: null, error: failure("boom") };
    expect(await bulkSetApplicationStatus([id], "offer", "")).toEqual({
      items: [{ applicationId: id, ok: false, errorCode: "CHARA_INVALID_TRANSITION", status: null }],
    });
  });

  it.each([
    [failure("CHARA_FEATURE_NOT_IN_PLAN", "read_only_free_plan"), { kind: "blocked", reason: "read_only_free_plan" }],
    [failure("CHARA_FORBIDDEN", "organization_suspended"), { kind: "blocked", reason: "organization_suspended" }],
    [failure("CHARA_INVALID_INPUT", "p_note"), { kind: "note_too_long" }],
    [failure("CHARA_INVALID_INPUT", "p_application_ids"), { kind: "failed" }],
    [{ code: "XX000", message: "internal error text", details: null }, { kind: "failed" }],
  ])("answers the refusal of the whole call %j as %j", async (error, expected) => {
    rpcResult = { data: null, error };
    expect(await bulkSetApplicationStatus([id], "interview", "")).toEqual({ refusal: expected });
    expect(calls).toHaveLength(1);
  });
});
