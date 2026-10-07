import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const getApplicantMock = vi.hoisted(() => vi.fn());
const addNoteMock = vi.hoisted(() => vi.fn());
const requestLinkMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/applicants", () => ({ getApplicant: getApplicantMock }));
vi.mock("@/lib/dal/applicant-review", () => ({ addApplicationNote: addNoteMock, requestDocumentLink: requestLinkMock }));

const { addInternalNote, openApplicantDocument } = await import("@/lib/actions/applicant-review");

const applicationId = "0a1b2c3d-0000-4000-8000-000000000001";
const documentId = "0a1b2c3d-0000-4000-8000-0000000000d1";

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgRoleMock.mockResolvedValue({ organization: { id: "o", slug: "acme" } });
  getApplicantMock.mockResolvedValue({ organizationId: "o" });
  addNoteMock.mockResolvedValue(null);
  requestLinkMock.mockResolvedValue({ url: "http://storage.example/link" });
});

describe("addInternalNote", () => {
  it("checks the membership of the address, adds the trimmed note under the organization of the application and refreshes the page", async () => {
    expect(await addInternalNote("acme", applicationId, { body: "  Call on Monday  " })).toEqual({ done: true });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme", "member", { hideFromOutsiders: true });
    expect(addNoteMock).toHaveBeenCalledWith(applicationId, "o", "Call on Monday");
    expect(revalidateMock).toHaveBeenCalledWith(`/en/org/acme/applicants/${applicationId}`);
  });

  it("does not call the database for a blank note or one over 2000 characters", async () => {
    expect((await addInternalNote("acme", applicationId, { body: "   " })).errors).toEqual({ body: "Enter a note" });
    expect((await addInternalNote("acme", applicationId, { body: "a".repeat(2001) })).errors).toEqual({
      body: "Note must be at most 2000 characters",
    });
    expect(addNoteMock).not.toHaveBeenCalled();
  });

  it("does not add a note to an application of another organization, or for an address or id that is not valid", async () => {
    getApplicantMock.mockResolvedValue({ organizationId: "other" });
    expect(await addInternalNote("acme", applicationId, { body: "x" })).toEqual({ message: "This applicant could not be found." });
    getApplicantMock.mockResolvedValue(null);
    expect(await addInternalNote("acme", applicationId, { body: "x" })).toEqual({ message: "This applicant could not be found." });
    expect((await addInternalNote("Not A Slug", applicationId, { body: "x" })).message).toBe("This applicant could not be found.");
    expect((await addInternalNote("acme", "not-a-uuid", { body: "x" })).message).toBe("This applicant could not be found.");
    expect(addNoteMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("does not reach the database when the caller is no member: the guard sends them away first", async () => {
    requireOrgRoleMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(addInternalNote("other", applicationId, { body: "x" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(addNoteMock).not.toHaveBeenCalled();
  });

  it.each([
    ["read_only_free_plan", "Your organization has no active paid plan, so notes cannot be added."],
    ["organization_suspended", "Your organization is suspended, so notes cannot be added."],
    ["not_found", "This applicant could not be found."],
    ["invalid", "The note could not be saved. Check it and try again."],
    ["failed", "We could not complete this request. Try again."],
  ])("answers the refusal %s with a message and no database text, and refreshes nothing", async (refusal, message) => {
    addNoteMock.mockResolvedValue(refusal);
    expect(await addInternalNote("acme", applicationId, { body: "x" })).toEqual({ message });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe("openApplicantDocument", () => {
  it("returns the link for a document of an application of the organization of the address", async () => {
    expect(await openApplicantDocument("acme", applicationId, documentId)).toEqual({ url: "http://storage.example/link" });
    expect(requestLinkMock).toHaveBeenCalledWith(documentId);
  });

  it("asks for no link for an application of another organization, or for ids that are not valid", async () => {
    getApplicantMock.mockResolvedValue({ organizationId: "other" });
    expect(await openApplicantDocument("acme", applicationId, documentId)).toEqual({ message: "This document is no longer available." });
    getApplicantMock.mockResolvedValue({ organizationId: "o" });
    expect((await openApplicantDocument("acme", applicationId, "not-a-uuid")).message).toBe("This document is no longer available.");
    expect((await openApplicantDocument("acme", "not-a-uuid", documentId)).message).toBe("This document is no longer available.");
    expect(requestLinkMock).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", "This document is no longer available."],
    ["not_scanned", "This file is still being checked and cannot be opened yet."],
    ["rate_limited", "Too many documents were opened in a short time. Wait a minute and try again."],
    ["failed", "We could not complete this request. Try again."],
  ])("answers the refusal %s with a message and no link", async (refusal, message) => {
    requestLinkMock.mockResolvedValue({ refusal });
    expect(await openApplicantDocument("acme", applicationId, documentId)).toEqual({ message });
  });
});
