import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const rpcMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requirePlatformRole: requireRoleMock }));
vi.mock("@/lib/dal/admin", () => ({ adminClient: async () => ({ rpc: rpcMock }) }));

const { closeReport, startReportReview } = await import("@/lib/actions/admin-reports");

const failure = (message: string, details = "") => ({ data: null, error: { message, details, code: "P0001" } });

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["trust_safety"] });
  rpcMock.mockResolvedValue({ data: null, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("startReportReview", () => {
  it("asks for the Trust & Safety role, puts the report in review and redraws its page", async () => {
    expect(await startReportReview(7)).toEqual({ done: true });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["trust_safety"]);
    expect(rpcMock).toHaveBeenCalledWith("admin_set_report_status", { p_id: 7, p_status: "in_review" });
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/reports/7");
  });

  it("calls nothing for an id that is no report id", async () => {
    expect(await startReportReview(0)).toEqual({ message: "This report no longer exists." });
    expect(requireRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("says another staff member moved the report first, and sends a staff member below aal2 to confirm it", async () => {
    rpcMock.mockResolvedValueOnce(failure("CHARA_INVALID_STATE", "in_review"));
    expect(await startReportReview(7)).toEqual({ message: "This report was moved by someone else. Reload the page." });
    rpcMock.mockResolvedValueOnce(failure("CHARA_FORBIDDEN", "aal2_required"));
    await expect(startReportReview(7)).rejects.toThrow("REDIRECT:/en/mfa?next=%2Fen%2Fadmin%2Freports%2F7");
  });
});

describe("closeReport", () => {
  it("sends the trimmed note as the note of the closing", async () => {
    expect(await closeReport({ id: 7, status: "actioned", reason: "  The vacancy was hidden.  " })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("admin_set_report_status", { p_id: 7, p_status: "actioned", p_note: "The vacancy was hidden." });
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/reports/7");
  });

  it("refuses a short note with the field error and calls nothing", async () => {
    const result = await closeReport({ id: 7, status: "dismissed", reason: "short" });
    expect(result.errors).toEqual({ reason: "Give a reason of at least 10 characters" });
    expect(requireRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not close as in review or new", async () => {
    const result = await closeReport({ id: 7, status: "in_review" as "actioned", reason: "A reason that is long enough." });
    expect(result.errors).toHaveProperty("status");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("explains a closed report and hides the text of any other refusal", async () => {
    rpcMock.mockResolvedValueOnce(failure("CHARA_INVALID_STATE", "actioned"));
    expect((await closeReport({ id: 7, status: "dismissed", reason: "A reason that is long enough." })).message).toContain("moved by someone else");
    rpcMock.mockResolvedValueOnce(failure("duplicate key value violates unique constraint"));
    expect(await closeReport({ id: 7, status: "dismissed", reason: "A reason that is long enough." })).toEqual({
      message: "We could not complete this request. Try again.",
    });
  });
});
