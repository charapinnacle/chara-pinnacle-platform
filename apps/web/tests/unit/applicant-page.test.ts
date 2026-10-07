import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const getApplicantMock = vi.hoisted(() => vi.fn());
const listApplicantEventsMock = vi.hoisted(() => vi.fn());
const markApplicationViewedMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/applicants", () => ({
  getApplicant: getApplicantMock,
  listApplicantEvents: listApplicantEventsMock,
  markApplicationViewed: markApplicationViewedMock,
}));
vi.mock("@/components/applicants/stage-change", () => ({ StageChange: () => null }));

const { default: ApplicantPage } = await import("@/app/[lang]/(app)/org/[slug]/applicants/[applicationId]/page");

const applicationId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const props = () =>
  ({ params: Promise.resolve({ lang: "en", slug: "acme-bau", applicationId }) }) as Parameters<typeof ApplicantPage>[0];

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

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgRoleMock.mockResolvedValue({ user: { id: "user-1" }, organization });
  getApplicantMock.mockResolvedValue(applicant);
  listApplicantEventsMock.mockResolvedValue([]);
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
});
