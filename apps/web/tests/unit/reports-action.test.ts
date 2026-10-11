import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const proofMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));
vi.mock("@/lib/dal/rate-limit", () => ({ visitorProof: proofMock }));

const { submitReport } = await import("@/lib/actions/reports");

const ID = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const KEY = "a".repeat(64);
const DETAILS = "The vacancy asks for a fee before any work.";
const base = { category: "misleading_or_fraud", details: DETAILS, email: "", goodFaith: true } as const;
const failure = (message: string, details = "") => ({ data: null, error: { message, details, code: "P0001" } });

beforeEach(() => {
  vi.clearAllMocks();
  proofMock.mockResolvedValue({ key: KEY, proof: "proof-of-this-minute" });
  rpcMock.mockResolvedValue({ data: [{ reference: "R-000042", is_duplicate: false }], error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("submitReport", () => {
  it("resolves the vacancy from a pasted link, counts the visitor with the proof of the web tier and returns the reference", async () => {
    const result = await submitReport({ ...base, type: "job", target: `https://chara.example/en/jobs/${ID}?x=1`, email: " visitor@example.test " });

    expect(result).toEqual({ reference: "R-000042" });
    expect(proofMock).toHaveBeenCalledWith("report");
    expect(rpcMock).toHaveBeenCalledWith("submit_report", {
      p_target_type: "job",
      p_job: ID,
      p_application: undefined,
      p_path: undefined,
      p_category: "misleading_or_fraud",
      p_details: DETAILS,
      p_good_faith: true,
      p_email: "visitor@example.test",
      p_key: KEY,
      p_proof: "proof-of-this-minute",
    });
  });

  it("sends the vacancy of a company report, the application of a profile report and the path of a page", async () => {
    await submitReport({ ...base, type: "company", target: ID });
    await submitReport({ ...base, type: "profile", target: ID });
    await submitReport({ ...base, type: "content", target: "https://chara.example/en/pricing?x=1#top" });
    const sent = rpcMock.mock.calls.map(([, args]) => [args.p_target_type, args.p_job, args.p_application, args.p_path]);
    expect(sent).toEqual([
      ["company", ID, undefined, undefined],
      ["profile", undefined, ID, undefined],
      ["content", undefined, undefined, "/en/pricing"],
    ]);
  });

  it("returns the field errors of an invalid report without calling the database", async () => {
    const result = await submitReport({ ...base, type: "job", target: ID, details: "short", category: "", goodFaith: false });
    expect(Object.keys(result.errors ?? {}).sort()).toEqual(["category", "details", "goodFaith"]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("names the link when the target is not a vacancy or a page", async () => {
    expect((await submitReport({ ...base, type: "job", target: "welder" })).errors).toEqual({ link: "Paste the address of a vacancy page on CHARA." });
    expect((await submitReport({ ...base, type: "content", target: "//evil.example" })).errors).toEqual({ link: "Enter the address of a page of CHARA." });
    expect((await submitReport({ ...base, type: "profile", target: "not-an-id" })).errors).toHaveProperty("link");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("says a vacancy that is not public cannot be reported, and an applicant that is not found", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_NOT_FOUND"));
    expect((await submitReport({ ...base, type: "job", target: ID })).errors?.link).toContain("not public");
    expect(await submitReport({ ...base, type: "profile", target: ID })).toEqual({ message: "This applicant could not be found." });
  });

  it("tells a visitor over the limit to wait, without a field error", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_RATE_LIMITED", "120"));
    expect(await submitReport({ ...base, type: "job", target: ID })).toEqual({ message: "You have sent several reports in a short time. Try again in a while." });
  });

  it("sends a member below aal2 to two-step verification and tells anyone else who may not report an applicant", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "aal2_required"));
    await expect(submitReport({ ...base, type: "profile", target: ID })).rejects.toThrow("REDIRECT:/en/mfa");
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "company_account_required"));
    expect((await submitReport({ ...base, type: "profile", target: ID })).message).toContain("members of a company");
  });

  it("says nothing about members when the proof of the throttle is refused, whatever the kind of report", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "p_proof"));
    for (const type of ["job", "profile"] as const) {
      expect(await submitReport({ ...base, type, target: ID })).toEqual({ message: "We could not complete this request. Try again." });
    }
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("tells a visitor who reports a candidate to sign in as a member", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "sign_in_required"));
    expect((await submitReport({ ...base, type: "profile", target: ID })).message).toContain("members of a company");
  });

  it("maps a refusal of the database to the field and hides anything else behind the generic message", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_INVALID_INPUT", "good_faith"));
    expect((await submitReport({ ...base, type: "job", target: ID })).errors).toEqual({ goodFaith: "Check this value." });
    rpcMock.mockResolvedValue(failure("relation reports does not exist"));
    const result = await submitReport({ ...base, type: "job", target: ID });
    expect(result).toEqual({ message: "We could not complete this request. Try again." });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("relation reports");
  });
});
