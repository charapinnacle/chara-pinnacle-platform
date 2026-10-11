import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const proofMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));
vi.mock("@/lib/dal/rate-limit", () => ({ visitorProof: proofMock }));

const { listMyReports, submitReport } = await import("@/lib/dal/reports");

const ID = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

beforeEach(() => {
  vi.clearAllMocks();
  proofMock.mockResolvedValue({ key: "k".repeat(64), proof: "p" });
});

describe("submitReport", () => {
  const report = { category: "other", details: "Twenty characters or more of text.", email: "" } as const;

  it("sends the target by the parameter of its kind, the key and the proof, and no email when there is none", async () => {
    rpcMock.mockResolvedValue({ data: [{ reference: "R-000007", is_duplicate: true }], error: null });
    await expect(submitReport({ type: "company", job: ID }, report)).resolves.toEqual({ ok: true, reference: "R-000007" });
    expect(rpcMock).toHaveBeenCalledWith("submit_report", {
      p_target_type: "company",
      p_job: ID,
      p_application: undefined,
      p_path: undefined,
      p_category: "other",
      p_details: report.details,
      p_good_faith: true,
      p_email: undefined,
      p_key: "k".repeat(64),
      p_proof: "p",
    });
  });

  it("returns the refusal of the database for the action to explain", async () => {
    const error = { message: "CHARA_RATE_LIMITED", details: "30", code: "P0001" };
    rpcMock.mockResolvedValue({ data: null, error });
    await expect(submitReport({ type: "content", path: "/en/jobs" }, report)).resolves.toEqual({ ok: false, error });
  });

  it("does not take an answer that is not one row with a reference", async () => {
    rpcMock.mockResolvedValue({ data: [{ reference: "7", is_duplicate: false }], error: null });
    await expect(submitReport({ type: "job", job: ID }, report)).rejects.toThrow();
  });
});

describe("listMyReports", () => {
  const row = (n: number) => ({
    id: n,
    reference: `R-${String(n).padStart(6, "0")}`,
    target_type: "job",
    target_label: `Welder ${n}`,
    category: "other",
    status: n % 2 ? "new" : "actioned",
    resolution_note: n % 2 ? null : "Hidden.",
    handled_at: n % 2 ? null : "2026-10-10T10:00:00+00:00",
    created_at: `2026-10-09T10:00:${String(60 - n).padStart(2, "0")}.123456+00:00`,
  });

  it("reads one row more than a page, shows 25 and hands over the cursor of the last row shown", async () => {
    rpcMock.mockResolvedValue({ data: Array.from({ length: 26 }, (_, n) => row(n + 1)), error: null });
    const page = await listMyReports({ at: "2026-10-10T00:00:00+00:00", id: 99 });
    expect(rpcMock).toHaveBeenCalledWith("list_my_reports", { p_limit: 26, p_after_created: "2026-10-10T00:00:00+00:00", p_after_id: 99 });
    expect(page.reports).toHaveLength(25);
    expect(page.next).toEqual({ at: row(25).created_at, id: 25 });
    expect(page.reports[1]).toEqual({
      id: 2,
      reference: "R-000002",
      targetType: "job",
      targetLabel: "Welder 2",
      category: "other",
      status: "actioned",
      resolutionNote: "Hidden.",
      handledAt: "2026-10-10T10:00:00+00:00",
      createdAt: row(2).created_at,
    });
  });

  it("has no next page for a short page and no note on an open report", async () => {
    rpcMock.mockResolvedValue({ data: [row(1)], error: null });
    const page = await listMyReports(null);
    expect(page.next).toBeNull();
    expect(page.reports[0]).toMatchObject({ resolutionNote: null, handledAt: null });
    expect(rpcMock).toHaveBeenCalledWith("list_my_reports", { p_limit: 26, p_after_created: undefined, p_after_id: undefined });
  });

  it("fails loudly when the list cannot be read", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "secret detail" } });
    await expect(listMyReports(null)).rejects.toThrow("The reports could not be loaded");
  });
});
