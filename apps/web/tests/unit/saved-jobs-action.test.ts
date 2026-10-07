import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateMock = vi.hoisted(() => vi.fn());
const requireUserMock = vi.hoisted(() => vi.fn());
const logMock = vi.hoisted(() => vi.fn());

type Call = { table: string; operation: string; values?: unknown; options?: unknown; filters: Record<string, unknown> };
const calls: Call[] = [];
let outcome: { error: unknown } = { error: null };

function from(table: string) {
  const call: Call = { table, operation: "", filters: {} };
  const chain = {
    upsert: (values: unknown, options: unknown) => {
      Object.assign(call, { operation: "upsert", values, options });
      calls.push(call);
      return Promise.resolve(outcome);
    },
    delete: () => Object.assign(call, { operation: "delete" }) && chain,
    eq: (column: string, value: unknown) => Object.assign(call.filters, { [column]: value }) && chain,
    then: (resolve: (value: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve(outcome).then(resolve);
    },
  };
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/jobs/vacancy-log", () => ({ logVacancy: logMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

const { setSavedJob } = await import("@/lib/actions/saved-jobs");

const userId = "0a1b2c3d-0000-4000-8000-0000000000aa";
const jobId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const GENERIC = "We could not complete this request. Try again.";

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  outcome = { error: null };
  requireUserMock.mockResolvedValue({ id: userId, accountKind: "worker" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("setSavedJob", () => {
  it("saves with the user from the session, ignoring a repeated row, and counts the press", async () => {
    expect(await setSavedJob(jobId, true)).toEqual({});
    expect(calls).toEqual([
      {
        table: "saved_jobs",
        operation: "upsert",
        values: { worker_user_id: userId, job_id: jobId },
        options: { onConflict: "worker_user_id,job_id", ignoreDuplicates: true },
        filters: {},
      },
    ]);
    expect(logMock).toHaveBeenCalledWith({ event: "vacancy_action", action: "save", jobId, viewer: "candidate" });
    expect(revalidateMock).toHaveBeenCalledWith("/en/saved");
  });

  it("unsaves only the row of this user and vacancy, and counts nothing", async () => {
    expect(await setSavedJob(jobId, false)).toEqual({});
    expect(calls).toEqual([
      { table: "saved_jobs", operation: "delete", filters: { worker_user_id: userId, job_id: jobId } },
    ]);
    expect(logMock).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith("/en/saved");
  });

  it("refuses a company account before it reaches the database", async () => {
    requireUserMock.mockResolvedValue({ id: userId, accountKind: "company" });
    expect(await setSavedJob(jobId, true)).toEqual({ message: "Only candidates can save vacancies." });
    expect(calls).toEqual([]);
    expect(logMock).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a uuid and a value that is not a boolean", async () => {
    for (const id of ["", "not-an-id", "../x", `${jobId}x`]) {
      expect(await setSavedJob(id, true)).toEqual({ message: GENERIC });
    }
    expect(await setSavedJob(jobId, "yes" as unknown as boolean)).toEqual({ message: GENERIC });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("tells the candidate that a vacancy that is no longer public cannot be saved", async () => {
    outcome = { error: { code: "42501", message: 'new row violates row-level security policy for table "saved_jobs"' } };
    expect(await setSavedJob(jobId, true)).toEqual({ message: "This vacancy can no longer be saved." });
    expect(logMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("does not call a missing privilege a vacancy that is no longer public", async () => {
    outcome = { error: { code: "42501", message: "permission denied for table saved_jobs" } };
    expect(await setSavedJob(jobId, true)).toEqual({ message: GENERIC });
  });

  it("answers any other failure with the generic message and names nothing of the cause", async () => {
    outcome = { error: { code: "XX000", message: "connection to server lost" } };
    for (const saved of [true, false]) {
      expect(await setSavedJob(jobId, saved)).toEqual({ message: GENERIC });
    }
    expect(logMock).not.toHaveBeenCalled();
  });

  it("lets the redirect of a signed-out or suspended user through", async () => {
    requireUserMock.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(setSavedJob(jobId, true)).rejects.toThrow("NEXT_REDIRECT");
    expect(calls).toEqual([]);
  });
});
