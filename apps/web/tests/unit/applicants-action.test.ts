import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const setStatusMock = vi.hoisted(() => vi.fn());
const bulkMock = vi.hoisted(() => vi.fn());
const getApplicantMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());
const boardCountsMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/applicants", () => ({ setApplicationStatus: setStatusMock, getApplicant: getApplicantMock, bulkSetApplicationStatus: bulkMock }));
vi.mock("@/lib/dal/applicant-list", () => ({ getBoardCounts: boardCountsMock }));

const { bulkChangeApplicantStage, changeApplicantStage, readBoardCounts } = await import("@/lib/actions/applicants");

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
    expect((await changeApplicantStage("Not A Slug", applicationId, input)).message).toBe("This applicant could not be found.");
    expect((await changeApplicantStage("acme", "not-a-uuid", input)).message).toBe("This applicant could not be found.");
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

describe("bulkChangeApplicantStage", () => {
  const second = "0a1b2c3d-0000-4000-8000-000000000002";
  const bulkInput = { applicationIds: [applicationId, second], status: "rejected", note: " Position filled " };

  beforeEach(() => {
    requireOrgRoleMock.mockResolvedValue({ organization: { id: "o", slug: "acme", suspended: false } });
  });

  it("checks the membership of the address, sends its organization id with the ids, the target and the trimmed note, and reports each item", async () => {
    bulkMock.mockResolvedValue({
      items: [
        { applicationId, ok: true, errorCode: null, status: null },
        { applicationId: second, ok: false, errorCode: "CHARA_INVALID_TRANSITION", status: "applied" },
      ],
    });
    expect(await bulkChangeApplicantStage("acme", bulkInput)).toEqual({
      summary: { updated: [applicationId], refused: [{ id: second, message: "Not allowed from Applied" }] },
    });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme", "member", { hideFromOutsiders: true });
    expect(bulkMock).toHaveBeenCalledWith("o", [applicationId, second], "rejected", "Position filled");
  });

  it.each([
    ["CHARA_NOT_FOUND", null, "This applicant could not be found."],
    ["CHARA_FEATURE_NOT_IN_PLAN", null, "Your plan does not include shortlisting."],
    ["CHARA_FORBIDDEN", null, "Your organization is suspended, so stages cannot be changed."],
    ["CHARA_INVALID_TRANSITION", null, "Not allowed from its current stage"],
    ["P0001", null, "We could not complete this request. Try again."],
  ])("words the refused item %s without database text", async (errorCode, status, message) => {
    bulkMock.mockResolvedValue({ items: [{ applicationId, ok: false, errorCode, status }] });
    expect((await bulkChangeApplicantStage("acme", { ...bulkInput, applicationIds: [applicationId] })).summary?.refused).toEqual([
      { id: applicationId, message },
    ]);
  });

  it("does not call the database for a selection of 0 or 101, an id that is not valid, a stage an employer cannot choose or a decline without a reason", async () => {
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `0a1b2c3d-0000-4000-8000-${String(index).padStart(12, "0")}`);
    const range = "Select between 1 and 100 applicants";
    expect((await bulkChangeApplicantStage("acme", { ...bulkInput, applicationIds: [] })).errors).toEqual({ applicationIds: range });
    expect((await bulkChangeApplicantStage("acme", { ...bulkInput, applicationIds: ids(101) })).errors).toEqual({ applicationIds: range });
    expect(Object.keys((await bulkChangeApplicantStage("acme", { ...bulkInput, applicationIds: ["nope"] })).errors ?? {})).toEqual(["applicationIds.0"]);
    expect((await bulkChangeApplicantStage("acme", { ...bulkInput, status: "withdrawn" })).errors).toEqual({ status: "Choose a stage" });
    expect((await bulkChangeApplicantStage("acme", { ...bulkInput, note: "  " })).errors).toEqual({ note: "Enter a reason" });
    expect(bulkMock).not.toHaveBeenCalled();
  });

  it("sends 100 ids", async () => {
    const hundred = Array.from({ length: 100 }, (_, index) => `0a1b2c3d-0000-4000-8000-${String(index).padStart(12, "0")}`);
    bulkMock.mockResolvedValue({ items: [] });
    expect((await bulkChangeApplicantStage("acme", { ...bulkInput, applicationIds: hundred })).summary).toEqual({ updated: [], refused: [] });
    expect(bulkMock).toHaveBeenCalledWith("o", hundred, "rejected", "Position filled");
  });

  it("refuses an address that is not valid and a suspended organization before the database", async () => {
    expect(await bulkChangeApplicantStage("Not A Slug", bulkInput)).toEqual({ message: "This applicant could not be found." });
    requireOrgRoleMock.mockResolvedValue({ organization: { id: "o", slug: "acme", suspended: true } });
    expect(await bulkChangeApplicantStage("acme", bulkInput)).toEqual({ message: "Your organization is suspended, so stages cannot be changed." });
    expect(bulkMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "blocked", reason: "read_only_free_plan" }, { message: "Your organization has no active paid plan, so stages cannot be changed." }],
    [{ kind: "note_too_long" }, { errors: { note: "The note is too long." } }],
    [{ kind: "failed" }, { message: "We could not complete this request. Try again." }],
  ])("answers the refusal of the whole call %j as %j", async (refusal, expected) => {
    bulkMock.mockResolvedValue({ refusal });
    expect(await bulkChangeApplicantStage("acme", bulkInput)).toEqual(expected);
  });

  it("does not reach the database when the caller is no member: the guard sends them away first", async () => {
    requireOrgRoleMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(bulkChangeApplicantStage("other", bulkInput)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(bulkMock).not.toHaveBeenCalled();
  });
});
