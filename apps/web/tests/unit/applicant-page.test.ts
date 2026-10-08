import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const requireUserMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT ${path}`);
  }),
);
const getApplicantMock = vi.hoisted(() => vi.fn());
const listApplicantEventsMock = vi.hoisted(() => vi.fn());
const markApplicationViewedMock = vi.hoisted(() => vi.fn());
const getProfileMock = vi.hoisted(() => vi.fn());
const listDocumentsMock = vi.hoisted(() => vi.fn());
const profileChangedMock = vi.hoisted(() => vi.fn());
const listNotesMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock, requireUser: requireUserMock }));
vi.mock("@/lib/dal/applicants", () => ({
  getApplicant: getApplicantMock,
  listApplicantEvents: listApplicantEventsMock,
  markApplicationViewed: markApplicationViewedMock,
}));
vi.mock("@/lib/dal/applicant-review", () => ({
  getApplicantProfile: getProfileMock,
  listSharedDocuments: listDocumentsMock,
  isProfileChanged: profileChangedMock,
  listApplicationNotes: listNotesMock,
}));
vi.mock("@/lib/dal/reference", () => ({
  getCountries: async () => [{ code: "PT", name: "Portugal" }],
  getLanguages: async () => [{ code: "en", name: "English" }],
}));
const stageChangeMock = vi.hoisted(() => vi.fn<(props: { targets: string[] }) => null>(() => null));
vi.mock("@/components/applicants/stage-change", () => ({ StageChange: stageChangeMock }));
vi.mock("@/components/applicants/open-document-button", () => ({
  OpenDocumentButton: ({ title }: { title: string }) => `[open ${title}]`,
}));
vi.mock("@/components/applicants/note-form", () => ({ NoteForm: () => "[note form]" }));

const { default: ApplicantPage } = await import("@/app/[lang]/(app)/org/[slug]/applicants/[applicationId]/page");

const applicationId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const props = (query: Record<string, string> = {}) =>
  ({
    params: Promise.resolve({ lang: "en", slug: "acme-bau", applicationId }),
    searchParams: Promise.resolve(query),
  }) as Parameters<typeof ApplicantPage>[0];

const organization = { id: "org-1", slug: "acme-bau", displayName: "Acme Bau", role: "member", suspended: false };
const applicant = {
  id: applicationId,
  organizationId: "org-1",
  jobTitle: "Welder",
  applicantName: "Ana Silva",
  status: "viewed",
  appliedAt: "2026-10-03T10:00:00Z",
  shortlistingAvailable: true,
  stageChangeBlocked: null,
  noteMaxChars: 1000,
};

const snapshot = {
  first_name: "Ana",
  last_name: "Silva",
  headline: "Welder",
  current_country: "PT",
  occupation: "Welders and flame cutters",
  years_experience: 6,
  availability: "from_date",
  available_from: "2026-11-01",
  skills: ["MIG welding", "TIG welding"],
  languages: [{ code: "en", level: "C1" }],
  preferred_countries: ["PT"],
  work_authorizations: [{ country: "PT", expires_on: "2030-05-01" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company" });
  requireOrgRoleMock.mockResolvedValue({ user: { id: "user-1" }, organization });
  getApplicantMock.mockResolvedValue(applicant);
  listApplicantEventsMock.mockResolvedValue([]);
  getProfileMock.mockResolvedValue({ snapshot, coverNote: "I weld every day." });
  listDocumentsMock.mockResolvedValue([]);
  profileChangedMock.mockResolvedValue(false);
  listNotesMock.mockResolvedValue({ notes: [], hasMore: false });
});

describe("the applicant page of FR-D5", () => {
  it("shows no applicant of a suspended organization and reads nothing about one", async () => {
    requireOrgRoleMock.mockResolvedValue({ user: { id: "user-1" }, organization: { ...organization, suspended: true } });
    const html = renderToStaticMarkup(await ApplicantPage(props()));
    expect(html).toContain("This organization is suspended, so its applicants are not available.");
    expect(html).not.toContain("Ana Silva");
    expect(getApplicantMock).not.toHaveBeenCalled();
    expect(markApplicationViewedMock).not.toHaveBeenCalled();
  });

  it("sends a candidate to their own home before anything about the organization or the application is read", async () => {
    requireUserMock.mockResolvedValue({ id: "user-2", accountKind: "worker" });
    await expect(ApplicantPage(props())).rejects.toThrow("REDIRECT /en/dashboard/worker");
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
    expect(getApplicantMock).not.toHaveBeenCalled();
    expect(markApplicationViewedMock).not.toHaveBeenCalled();
  });

  it("answers an application of another organization as not found, without opening it", async () => {
    getApplicantMock.mockResolvedValue({ ...applicant, organizationId: "org-2", status: "applied" });
    await expect(ApplicantPage(props())).rejects.toThrow("NOT_FOUND");
    expect(markApplicationViewedMock).not.toHaveBeenCalled();
  });

  it("answers an application the database does not show as not found", async () => {
    getApplicantMock.mockResolvedValue(null);
    await expect(ApplicantPage(props())).rejects.toThrow("NOT_FOUND");
    expect(markApplicationViewedMock).not.toHaveBeenCalled();
  });

  it("shows the applicant of an active organization", async () => {
    const html = renderToStaticMarkup(await ApplicantPage(props()));
    expect(html).toContain("Ana Silva");
  });

  it("shows the profile as submitted, with the date and the cover note, and no indicator when nothing changed", async () => {
    const html = renderToStaticMarkup(await ApplicantPage(props()));
    expect(html).toContain("Submitted 2026-10-03");
    for (const text of ["Welder", "Portugal", "6 years", "Available from November 1, 2026", "MIG welding", "English, C1", "valid until May 1, 2030", "I weld every day."]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Profile changed since this application was submitted");
  });

  it("shows the indicator when the live profile changed, and not what changed", async () => {
    profileChangedMock.mockResolvedValue(true);
    const html = renderToStaticMarkup(await ApplicantPage(props()));
    expect(html).toContain("Profile changed since this application was submitted");
    expect(html).toContain("Welder");
  });

  it("says the documents are no longer available when the share ended, and offers none", async () => {
    profileChangedMock.mockResolvedValue(null);
    const html = renderToStaticMarkup(await ApplicantPage(props()));
    expect(html).toContain("This document is no longer available");
    expect(html).not.toContain("Profile changed since");
  });

  it("lists the shared documents with an Open button for a checked file only, and no storage path", async () => {
    listDocumentsMock.mockResolvedValue([
      { id: "d1", title: "CV", type: "cv", fileName: "cv.pdf", sizeBytes: 2048, expiresOn: null, available: true },
      { id: "d2", title: "Certificate", type: "certificate", fileName: "cert.png", sizeBytes: 100, expiresOn: "2030-01-01", available: false },
    ]);
    const html = renderToStaticMarkup(await ApplicantPage(props()));
    expect(html).toContain("[open CV]");
    expect(html).not.toContain("[open Certificate]");
    expect(html).toContain("cv.pdf · 2 KB");
    expect(html).toContain("The file is still being checked");
    expect(html).not.toMatch(/storage|signed|token=/i);
  });

  it("says no document was shared when the list is empty and the share runs", async () => {
    expect(renderToStaticMarkup(await ApplicantPage(props()))).toContain("No documents were shared");
  });

  it("lists the internal notes with the author and the label, and the form", async () => {
    listNotesMock.mockResolvedValue({ notes: [{ id: 1, authorName: "Mia Member", body: "<b>x</b>", createdAt: "2026-10-04T09:00:00Z" }], hasMore: false });
    const html = renderToStaticMarkup(await ApplicantPage(props()));
    expect(html).toContain("Visible to your organization only");
    expect(html).toContain("Internal note");
    expect(html).toContain("Mia Member");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("[note form]");
  });

  it("offers no note form to an organization that has no active paid plan, and still lists its notes", async () => {
    getApplicantMock.mockResolvedValue({ ...applicant, stageChangeBlocked: "read_only_free_plan" });
    listNotesMock.mockResolvedValue({ notes: [{ id: 1, authorName: null, body: "Earlier note", createdAt: "2026-10-04T09:00:00Z" }], hasMore: false });
    const html = renderToStaticMarkup(await ApplicantPage(props()));
    expect(html).not.toContain("[note form]");
    expect(html).toContain("so notes cannot be added");
    expect(html).toContain("Earlier note");
    expect(html).toContain("Team member");
  });

  it("links to older notes from the last note of the page, and to the newest notes from an older page", async () => {
    const page = { notes: [{ id: 41, authorName: null, body: "Note 41", createdAt: "2026-10-04T09:00:00Z" }], hasMore: true };
    listNotesMock.mockResolvedValue(page);
    let html = renderToStaticMarkup(await ApplicantPage(props()));
    expect(listNotesMock).toHaveBeenLastCalledWith(applicationId, undefined);
    expect(html).toContain(`/en/org/acme-bau/applicants/${applicationId}?notesBefore=41`);
    expect(html).not.toContain("Back to the newest notes");
    listNotesMock.mockResolvedValue({ ...page, hasMore: false });
    html = renderToStaticMarkup(await ApplicantPage(props({ notesBefore: "60" })));
    expect(listNotesMock).toHaveBeenLastCalledWith(applicationId, 60);
    expect(html).toContain("Back to the newest notes");
    expect(html).not.toContain("Show older notes");
  });

  it("ignores a cursor that is not a number", async () => {
    await ApplicantPage(props({ notesBefore: "1; drop table" }));
    expect(listNotesMock).toHaveBeenLastCalledWith(applicationId, undefined);
  });

  it("offers Shortlisted only when the plan includes shortlisting", async () => {
    getApplicantMock.mockResolvedValue({ ...applicant, status: "viewed", shortlistingAvailable: true });
    renderToStaticMarkup(await ApplicantPage(props()));
    expect(stageChangeMock.mock.lastCall?.[0].targets).toEqual(["shortlisted", "interview", "rejected"]);
    getApplicantMock.mockResolvedValue({ ...applicant, status: "viewed", shortlistingAvailable: false });
    renderToStaticMarkup(await ApplicantPage(props()));
    expect(stageChangeMock.mock.lastCall?.[0].targets).toEqual(["interview", "rejected"]);
  });

  it("answers an application whose profile cannot be read as not found", async () => {
    getProfileMock.mockResolvedValue(null);
    await expect(ApplicantPage(props())).rejects.toThrow("NOT_FOUND");
  });

  it("marks the first open before it reads the page", async () => {
    getApplicantMock.mockResolvedValue({ ...applicant, status: "applied" });
    await ApplicantPage(props());
    expect(markApplicationViewedMock).toHaveBeenCalledTimes(1);
    expect(markApplicationViewedMock.mock.invocationCallOrder[0]).toBeLessThan(getProfileMock.mock.invocationCallOrder[0]);
  });

  it("does not mark an application that is not new", async () => {
    await ApplicantPage(props());
    expect(markApplicationViewedMock).not.toHaveBeenCalled();
  });
});
