import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());
const requireUserMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const rpcMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requirePlatformRole: requireRoleMock, requireUser: requireUserMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/admin", () => ({ adminClient: async () => ({ rpc: rpcMock }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { submitAppeal } = await import("@/lib/actions/appeals");
const { decideAppeal } = await import("@/lib/actions/admin-appeals");

const failure = (message: string, details: string | null = null) => ({ data: null, error: { message, details, code: "P0001" } });
const GROUNDS = "  Every placement on our profile is documented.  ";

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "owner", aal: "aal2" });
  requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["trust_safety"] });
  releasedMock.mockResolvedValue(true);
  rpcMock.mockResolvedValue({ data: [], error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// FR-S1 AC9, AC12: the owner or an admin appeals a decision with grounds of 20 to 2,000 characters.
describe("submitAppeal", () => {
  it("sends the trimmed grounds for the decision and redraws the decision pages", async () => {
    expect(await submitAppeal({ decision: 42, grounds: GROUNDS })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("submit_appeal", { p_action: 42, p_grounds: "Every placement on our profile is documented." });
    expect(revalidateMock).toHaveBeenCalledWith("/en/appeals/42");
    expect(revalidateMock).toHaveBeenCalledWith("/en/appeals");
  });

  it("refuses grounds of 19 or 2,001 characters with the field error and calls nothing", async () => {
    expect((await submitAppeal({ decision: 42, grounds: "Nineteen characters" })).errors).toEqual({ grounds: "Give grounds of at least 20 characters" });
    expect((await submitAppeal({ decision: 42, grounds: "g".repeat(2001) })).errors).toEqual({ grounds: "The grounds can have at most 2000 characters" });
    expect((await submitAppeal({ decision: 0, grounds: GROUNDS })).errors).toHaveProperty("decision");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls nothing while release 2a is off", async () => {
    releasedMock.mockResolvedValue(false);
    expect(await submitAppeal({ decision: 42, grounds: GROUNDS })).toEqual({ message: "Appeals are not open at the moment." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("explains each refusal of the database and sends a session below aal2 to confirm it", async () => {
    const cases: [string, string | null, string][] = [
      ["CHARA_INVALID_STATE", "appeal_exists", "This decision has already been appealed. Reload the page to see the appeal."],
      ["CHARA_INVALID_STATE", "appeal_window_closed", "The time to appeal this decision has ended."],
      ["CHARA_INVALID_STATE", "not_in_effect", "This decision is no longer in effect, so there is nothing to appeal. Reload the page."],
      ["CHARA_FORBIDDEN", null, "Only the owner or an admin of the organisation can appeal."],
      ["CHARA_NOT_FOUND", null, "This decision no longer exists."],
      ["something else", null, "We could not complete this request. Try again."],
    ];
    for (const [message, details, text] of cases) {
      rpcMock.mockResolvedValueOnce(failure(message, details));
      expect((await submitAppeal({ decision: 42, grounds: GROUNDS })).message, `${message}:${details}`).toBe(text);
    }
    rpcMock.mockResolvedValueOnce(failure("CHARA_INVALID_INPUT", "grounds"));
    expect((await submitAppeal({ decision: 42, grounds: GROUNDS })).errors).toEqual({ grounds: "Give grounds of 20 to 2000 characters" });
    rpcMock.mockResolvedValueOnce(failure("CHARA_FORBIDDEN", "aal2_required"));
    await expect(submitAppeal({ decision: 42, grounds: GROUNDS })).rejects.toThrow("REDIRECT:/en/mfa?next=%2Fen%2Fappeals%2F42");
  });
});

// FR-S1 AC9, AC11: a second Trust & Safety Administrator upholds or reverses.
describe("decideAppeal", () => {
  it("asks for Trust & Safety, sends the outcome and the trimmed reasons and redraws the appeal and the list", async () => {
    expect(await decideAppeal({ id: 7, outcome: "restore", reason: "  The profile meets the rules after review.  " })).toEqual({ done: true });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["trust_safety"]);
    expect(rpcMock).toHaveBeenCalledWith("decide_appeal", { p_appeal: 7, p_outcome: "restore", p_reasons: "The profile meets the rules after review." });
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/appeals/7");
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/appeals");
  });

  it("refuses a short statement or an unknown outcome and calls nothing", async () => {
    expect((await decideAppeal({ id: 7, outcome: "uphold", reason: "Too short" })).errors).toEqual({ reason: "Give a reason of at least 10 characters." });
    expect(await decideAppeal({ id: 7, outcome: "reverse" as "restore", reason: "A reason that is long enough." })).toHaveProperty("errors.outcome");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("tells the decider and a member of the organisation that another administrator decides, and a late reviewer the outcome", async () => {
    const input = { id: 7, outcome: "uphold", reason: "A reason that is long enough." } as const;
    rpcMock.mockResolvedValueOnce(failure("CHARA_FORBIDDEN", "same_reviewer"));
    expect((await decideAppeal(input)).message).toBe("You took this decision, so another Trust & Safety administrator decides the appeal.");
    rpcMock.mockResolvedValueOnce(failure("CHARA_FORBIDDEN", "own_organization"));
    expect((await decideAppeal(input)).message).toBe("You belong to this organisation, so another Trust & Safety administrator decides the appeal.");
    rpcMock.mockResolvedValueOnce(failure("CHARA_INVALID_STATE", "restored"));
    expect((await decideAppeal(input)).message).toBe("This appeal was decided by someone else, reload the page. It is now: Decision reversed.");
    rpcMock.mockResolvedValueOnce(failure("CHARA_FORBIDDEN", "aal2_required"));
    await expect(decideAppeal(input)).rejects.toThrow("REDIRECT:/en/mfa?next=%2Fen%2Fadmin%2Fappeals%2F7");
  });
});
