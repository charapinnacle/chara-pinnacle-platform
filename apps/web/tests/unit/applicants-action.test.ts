import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const setStatusMock = vi.hoisted(() => vi.fn());
const getApplicantMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());
const boardCountsMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/applicants", () => ({ setApplicationStatus: setStatusMock, getApplicant: getApplicantMock }));
vi.mock("@/lib/dal/applicant-list", () => ({ getBoardCounts: boardCountsMock }));

const { changeApplicantStage, readBoardCounts } = await import("@/lib/actions/applicants");

const applicationId = "0a1b2c3d-0000-4000-8000-000000000001";
const input = { status: "interview", note: "  Interviews in week 41  " };

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgRoleMock.mockResolvedValue({ organization: { id: "o", slug: "acme" } });
  setStatusMock.mockResolvedValue(null);
  getApplicantMock.mockResolvedValue({ organizationId: "o" });
});

describe("changeApplicantStage", () => {
  it("checks the membership of the address, sends the target and the trimmed note and refreshes the page", async () => {
    expect(await changeApplicantStage("acme", applicationId, input)).toEqual({ done: true });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme", "member", { hideFromOutsiders: true });
    expect(setStatusMock).toHaveBeenCalledWith(applicationId, "interview", "Interviews in week 41");
    expect(revalidateMock).toHaveBeenCalledWith(`/en/org/acme/applicants/${applicationId}`);
  });

  it("does not call the database for a target an employer cannot choose", async () => {
    for (const status of ["applied", "viewed", "withdrawn", "", "bogus"]) {
      expect((await changeApplicantStage("acme", applicationId, { status, note: "" })).errors).toEqual({ status: "Choose a stage" });
    }
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("needs a reason for a decline and sends it as the note", async () => {
    for (const note of ["", "   "]) {
      expect((await changeApplicantStage("acme", applicationId, { status: "rejected", note })).errors).toEqual({ note: "Enter a reason" });
    }
    expect(setStatusMock).not.toHaveBeenCalled();
    expect(await changeApplicantStage("acme", applicationId, { status: "rejected", note: " Position filled " })).toEqual({ done: true });
    expect(setStatusMock).toHaveBeenCalledWith(applicationId, "rejected", "Position filled");
  });

  it("does not call the database for an address or an id that is not valid", async () => {
    expect((await changeApplicantStage("Not A Slug", applicationId, input)).message).toBe("We could not complete this request. Try again.");
    expect((await changeApplicantStage("acme", "not-a-uuid", input)).message).toBe("We could not complete this request. Try again.");
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("does not change an application of another organization, whose slug is not the one of the address", async () => {
    getApplicantMock.mockResolvedValue({ organizationId: "other" });
    expect(await changeApplicantStage("acme", applicationId, input)).toEqual({ message: "This applicant could not be found." });
    getApplicantMock.mockResolvedValue(null);
    expect(await changeApplicantStage("acme", applicationId, input)).toEqual({ message: "This applicant could not be found." });
    expect(setStatusMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("does not reach the database when the caller is no member: the guard sends them away first", async () => {
    requireOrgRoleMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(changeApplicantStage("other", applicationId, input)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "already_moved" }, { message: "This applicant was already moved. Reload to see the current stage" }],
    [{ kind: "not_found" }, { message: "This applicant could not be found." }],
    [{ kind: "blocked", reason: "organization_suspended" }, { message: "Your organization is suspended, so stages cannot be changed." }],
    [{ kind: "blocked", reason: "read_only_free_plan" }, { message: "Your organization has no active paid plan, so stages cannot be changed." }],
    [{ kind: "shortlisting_not_in_plan" }, { message: "Your plan does not include shortlisting." }],
    [{ kind: "note_too_long" }, { errors: { note: "The note is too long." } }],
    [{ kind: "failed" }, { message: "We could not complete this request. Try again." }],
  ])("answers the refusal %j with a message and no database text", async (refusal, expected) => {
    setStatusMock.mockResolvedValue(refusal);
    expect(await changeApplicantStage("acme", applicationId, input)).toEqual(expected);
  });
});

describe("readBoardCounts", () => {
  const counts = { applied: 2, viewed: 0, shortlisted: 3, interview: 1, offer: 0, hired: 0, rejected: 0, withdrawn: 0 };

  it("answers the counts of the vacancy", async () => {
    boardCountsMock.mockResolvedValue(counts);
    expect(await readBoardCounts(applicationId)).toEqual(counts);
    expect(boardCountsMock).toHaveBeenCalledWith(applicationId);
  });

  it("answers null, without a lookup, for an id that is not valid", async () => {
    expect(await readBoardCounts("not-a-uuid")).toBeNull();
    expect(boardCountsMock).not.toHaveBeenCalled();
  });

  it("passes the refusal of the database on: a caller without a session gets an error, not counts", async () => {
    boardCountsMock.mockRejectedValue(new Error("The board counts could not be loaded"));
    await expect(readBoardCounts(applicationId)).rejects.toThrow("The board counts could not be loaded");
  });
});
