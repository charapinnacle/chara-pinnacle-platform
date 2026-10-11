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

const { moveReport } = await import("@/lib/actions/admin-reports");

const failure = (message: string, details = "") => ({ data: null, error: { message, details, code: "P0001" } });

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["trust_safety"] });
  rpcMock.mockResolvedValue({ data: null, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("moveReport", () => {
  it("asks for the Trust & Safety role, sends the trimmed reason and redraws the page of the report", async () => {
    expect(await moveReport({ id: 7, status: "actioned", reason: "  The vacancy was hidden.  " })).toEqual({ done: true });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["trust_safety"]);
    expect(rpcMock).toHaveBeenCalledWith("admin_set_report_status", { p_id: 7, p_status: "actioned", p_note: "The vacancy was hidden." });
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/reports/7");
  });

  it("puts a report in review with a reason, like every other move", async () => {
    expect(await moveReport({ id: 7, status: "in_review", reason: "Reading the report now." })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("admin_set_report_status", { p_id: 7, p_status: "in_review", p_note: "Reading the report now." });
  });

  it("refuses a short reason with the field error and calls nothing", async () => {
    for (const status of ["in_review", "dismissed"] as const) {
      const result = await moveReport({ id: 7, status, reason: "short" });
      expect(result.errors).toEqual({ reason: "Give a reason of at least 10 characters" });
    }
    expect(requireRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not move a report back to new, or one that has no id", async () => {
    const result = await moveReport({ id: 7, status: "new" as "actioned", reason: "A reason that is long enough." });
    expect(result.errors).toHaveProperty("status");
    expect(await moveReport({ id: 0, status: "actioned", reason: "A reason that is long enough." })).toHaveProperty("errors");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("says another staff member moved the report first, sends a staff member below aal2 to confirm it and hides the text of any other refusal", async () => {
    const input = { id: 7, status: "dismissed", reason: "A reason that is long enough." } as const;
    rpcMock.mockResolvedValueOnce(failure("CHARA_INVALID_STATE", "actioned"));
    expect((await moveReport(input)).message).toContain("moved by someone else");
    rpcMock.mockResolvedValueOnce(failure("CHARA_FORBIDDEN", "aal2_required"));
    await expect(moveReport(input)).rejects.toThrow("REDIRECT:/en/mfa?next=%2Fen%2Fadmin%2Freports%2F7");
    rpcMock.mockResolvedValueOnce(failure("duplicate key value violates unique constraint"));
    expect(await moveReport(input)).toEqual({ message: "We could not complete this request. Try again." });
  });
});
