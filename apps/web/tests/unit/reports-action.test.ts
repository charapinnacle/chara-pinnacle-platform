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
      p_partner: undefined,
      p_requirement: undefined,
      p_response: undefined,
      p_submission: undefined,
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

  it("FR-S1, FR-K4 AC10: sends the slug of a partner profile as the target partner_profile", async () => {
    expect(await submitReport({ ...base, type: "partner_profile", target: "manila-skills", category: "fee_demanded_from_worker" })).toEqual({ reference: "R-000042" });
    const [, args] = rpcMock.mock.calls[0];
    expect([args.p_target_type, args.p_partner, args.p_job, args.p_path, args.p_category]).toEqual([
      "partner_profile",
      "manila-skills",
      undefined,
      undefined,
      "fee_demanded_from_worker",
    ]);
  });

  it("says a partner profile that is not public cannot be reported, without a field error and whatever the slug", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_NOT_FOUND"));
    const notPublic = { message: "This company profile cannot be reported: it is not public." };
    expect(await submitReport({ ...base, type: "partner_profile", target: "gone-partner" })).toEqual(notPublic);
    expect(await submitReport({ ...base, type: "partner_profile", target: "Not A Slug!" })).toEqual(notPublic);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("V57: sends a job order, a response or a submission by its id, each in its own parameter", async () => {
    await submitReport({ ...base, type: "requirement", target: ID });
    await submitReport({ ...base, type: "partner_response", target: ID });
    await submitReport({ ...base, type: "candidate_submission", target: ID, category: "fee_demanded_from_worker" });
    const sent = rpcMock.mock.calls.map(([, args]) => [args.p_target_type, args.p_requirement, args.p_response, args.p_submission, args.p_job]);
    expect(sent).toEqual([
      ["requirement", ID, undefined, undefined, undefined],
      ["partner_response", undefined, ID, undefined, undefined],
      ["candidate_submission", undefined, undefined, ID, undefined],
    ]);
  });

  it("V57: says the same for an item that is not the caller's or does not exist, and asks a visitor to sign in", async () => {
    const notShared = { message: "This cannot be reported from your account. It may have been removed or it is not shared with you." };
    expect(await submitReport({ ...base, type: "partner_response", target: "not-an-id" })).toEqual(notShared);
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue(failure("CHARA_NOT_FOUND"));
    expect(await submitReport({ ...base, type: "requirement", target: ID })).toEqual(notShared);
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "sign_in_required"));
    expect(await submitReport({ ...base, type: "candidate_submission", target: ID })).toEqual({ message: "Sign in to report this." });
  });

  it("returns the field errors of an invalid report without calling the database", async () => {
    const result = await submitReport({ ...base, type: "job", target: ID, details: "short", category: "", goodFaith: false });
    expect(Object.keys(result.errors ?? {}).sort()).toEqual(["category", "details", "goodFaith"]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("names the link when the target is not a vacancy or a page", async () => {
    expect((await submitReport({ ...base, type: "job", target: "welder" })).errors).toEqual({ link: "Paste the address of a vacancy page on Chara Pinnacle." });
    expect((await submitReport({ ...base, type: "content", target: "//evil.example" })).errors).toEqual({ link: "Enter the address of a page of Chara Pinnacle, for example /en/jobs." });
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
