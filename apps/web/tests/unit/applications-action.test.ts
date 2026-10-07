import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${path};307;` });
  }),
);
const requireUserMock = vi.hoisted(() => vi.fn());
const applyMock = vi.hoisted(() => vi.fn());
const limitsMock = vi.hoisted(() => vi.fn());
const withdrawMock = vi.hoisted(() => vi.fn());
const readMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/applications", () => ({
  applyToJob: applyMock,
  getApplyLimits: limitsMock,
  withdrawApplication: withdrawMock,
  getMyApplication: readMock,
}));

const { applyToVacancy, withdrawMyApplication } = await import("@/lib/actions/applications");

const jobId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const applicationId = "0a1b2c3d-0000-4000-8000-000000000001";
const documentId = "0a1b2c3d-0000-4000-8000-0000000000d1";
const valid = { coverNote: "  Hello  ", documentIds: [documentId, documentId], consent: true };

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "u", accountKind: "worker" });
  limitsMock.mockResolvedValue({ coverNoteMaxChars: 2000, documentsMax: 10 });
});

describe("applyToVacancy", () => {
  it("sends the trimmed note and the distinct documents, and ends on the application page", async () => {
    applyMock.mockResolvedValue({ kind: "created", applicationId });
    await expect(applyToVacancy(jobId, valid)).rejects.toMatchObject({ digest: `NEXT_REDIRECT;replace;/en/applications/${applicationId};307;` });
    expect(applyMock).toHaveBeenCalledWith(jobId, "Hello", [documentId]);
  });

  it("sends a note of only spaces as no note", async () => {
    applyMock.mockResolvedValue({ kind: "created", applicationId });
    await expect(applyToVacancy(jobId, { ...valid, coverNote: "   " })).rejects.toThrow("NEXT_REDIRECT");
    expect(applyMock).toHaveBeenCalledWith(jobId, null, [documentId]);
  });

  it("sends a repeated application to the application page with the notice", async () => {
    applyMock.mockResolvedValue({ kind: "existing", applicationId });
    await expect(applyToVacancy(jobId, valid)).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/en/applications/${applicationId}?existing=1;307;`,
    });
  });

  it("does not call the database when the consent is not ticked", async () => {
    expect(await applyToVacancy(jobId, { ...valid, consent: false })).toEqual({
      errors: { consent: "Confirm that you agree to share the selected documents" },
    });
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("does not call the database for a note over the limit, too many documents or an id that is not a vacancy", async () => {
    expect((await applyToVacancy(jobId, { ...valid, coverNote: "a".repeat(2001) }))?.errors).toEqual({
      coverNote: "Cover note must be at most 2000 characters",
    });
    const many = Array.from({ length: 11 }, (_, i) => `0a1b2c3d-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect((await applyToVacancy(jobId, { ...valid, documentIds: many }))?.errors).toEqual({ documentIds: "Select at most 10 documents" });
    expect((await applyToVacancy("not-a-uuid", valid))?.message).toBe("We could not complete this request. Try again.");
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("refuses an account that is not a candidate before it reads anything else", async () => {
    requireUserMock.mockResolvedValue({ id: "u", accountKind: "company" });
    expect(await applyToVacancy(jobId, valid)).toEqual({ message: "Only candidates can apply for vacancies." });
    expect(applyMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "not_open" }, { message: "This vacancy is no longer accepting applications", notOpen: true }],
    [{ kind: "rate_limited" }, { message: "You have sent many applications in a short time. Try again later." }],
    [{ kind: "document_not_found" }, { message: "One of the selected documents is no longer available. Reload the page and choose again." }],
    [{ kind: "forbidden" }, { message: "Only an active candidate account can apply." }],
    [{ kind: "failed" }, { message: "We could not complete this request. Try again." }],
    [
      { kind: "profile_incomplete", missing: ["occupation_id"] },
      { message: "Your passport is incomplete: add your occupation, then apply again." },
    ],
  ])("answers the refusal %j with a message and no database text", async (refusal, expected) => {
    applyMock.mockResolvedValue(refusal);
    expect(await applyToVacancy(jobId, valid)).toEqual(expected);
  });
});

describe("withdrawMyApplication", () => {
  it("withdraws the application of the session and refreshes the page and the list", async () => {
    withdrawMock.mockResolvedValue(null);
    expect(await withdrawMyApplication(applicationId)).toEqual({});
    expect(withdrawMock).toHaveBeenCalledWith(applicationId);
    expect(revalidateMock.mock.calls).toEqual([[`/en/applications/${applicationId}`], ["/en/applications"]]);
  });

  it("asks for the session before it reads anything", async () => {
    requireUserMock.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(withdrawMyApplication(applicationId)).rejects.toThrow("NEXT_REDIRECT");
    expect(withdrawMock).not.toHaveBeenCalled();
  });

  it("does not call the database for an id that is not a uuid", async () => {
    expect(await withdrawMyApplication("not-a-uuid")).toEqual({ message: "We could not complete this request. Try again." });
    expect(withdrawMock).not.toHaveBeenCalled();
  });

  it("treats an application that is already withdrawn as done, so a second press is no error", async () => {
    withdrawMock.mockResolvedValue({ kind: "not_withdrawable" });
    readMock.mockResolvedValue({ status: "withdrawn" });
    expect(await withdrawMyApplication(applicationId)).toEqual({});
  });

  it("tells a candidate whose application reached a final stage meanwhile that it cannot be withdrawn", async () => {
    withdrawMock.mockResolvedValue({ kind: "not_withdrawable" });
    readMock.mockResolvedValue({ status: "hired" });
    expect(await withdrawMyApplication(applicationId)).toEqual({ message: "This application can no longer be withdrawn. Reload to see its stage." });
  });

  it.each([
    [{ kind: "not_found" }, { message: "This application could not be found." }],
    [{ kind: "failed" }, { message: "We could not complete this request. Try again." }],
  ])("answers the refusal %j with a message and no database text", async (refusal, expected) => {
    withdrawMock.mockResolvedValue(refusal);
    expect(await withdrawMyApplication(applicationId)).toEqual(expected);
  });
});
