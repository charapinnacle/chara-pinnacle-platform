import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.hoisted(() => vi.fn());
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const getJobMock = vi.hoisted(() => vi.fn());
const getAccessMock = vi.hoisted(() => vi.fn());
const listApplicantsMock = vi.hoisted(() => vi.fn());
const listBoardMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: redirectMock, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock, requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/hiring", () => ({ getJob: getJobMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/dal/applicant-list", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dal/applicant-list")>()),
  getApplicantAccess: getAccessMock,
  listApplicants: listApplicantsMock,
  listBoard: listBoardMock,
}));
vi.mock("@/components/applicants/board", () => ({ Board: (props: { frozen: boolean }) => `BOARD frozen=${props.frozen}` }));
vi.mock("@/components/applicants/bulk-toolbar", () => ({
  BulkToolbar: (props: { slug: string; shortlisting: boolean; noteMaxChars: number }) =>
    `TOOLBAR ${props.slug} shortlisting=${props.shortlisting} note=${props.noteMaxChars}`,
}));
vi.mock("@/components/applications/stage-filter", () => ({ StageFilter: (props: { basePath: string }) => `FILTER ${props.basePath}` }));

const { default: ApplicantsPage } = await import("@/app/[lang]/(app)/org/[slug]/applicants/page");

const job = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const props = (query: Record<string, string> = {}) =>
  ({ params: Promise.resolve({ lang: "en", slug: "acme-bau" }), searchParams: Promise.resolve(query) }) as Parameters<typeof ApplicantsPage>[0];
const render = async (query?: Record<string, string>) => renderToStaticMarkup(await ApplicantsPage(props(query)));

const organization = { id: "org-1", slug: "acme-bau", displayName: "Acme Bau", role: "member", suspended: false };
const access = { stageChangeBlocked: null, shortlistingAvailable: true, csvExportAvailable: true, noteMaxChars: 1000 };
const row = (id: string, name: string | null, status = "applied") => ({
  id, jobId: job, jobTitle: "Welder", candidateName: name, status, appliedAt: "2026-09-04T10:00:00+00:00", completeness: 80, documents: 2,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "company" });
  requireOrgRoleMock.mockResolvedValue({ user: { id: "user-1" }, organization });
  getAccessMock.mockResolvedValue(access);
  getJobMock.mockResolvedValue({ id: job, title: "Welder" });
  listApplicantsMock.mockResolvedValue({ rows: [row("a1", "Ana Silva"), row("a2", "Ben Okoro", "shortlisted")], total: 2, page: 1 });
});

describe("the access rules of the applicants page", () => {
  it("sends a candidate to their own home and reads nothing", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "worker" });
    await expect(render()).rejects.toThrow("REDIRECT:/en/dashboard/worker");
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
    expect(listApplicantsMock).not.toHaveBeenCalled();
  });

  it("asks for the member role of the organization in the address and hides it from outsiders", async () => {
    await render();
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme-bau", "member", { hideFromOutsiders: true });
  });

  it("shows no applicant of a suspended organization and reads nothing about one", async () => {
    requireOrgRoleMock.mockResolvedValue({ user: { id: "user-1" }, organization: { ...organization, suspended: true } });
    const html = await render();
    expect(html).toContain("This organization is suspended, so its applicants are not available.");
    expect(getAccessMock).not.toHaveBeenCalled();
    expect(listApplicantsMock).not.toHaveBeenCalled();
  });

  it("answers a vacancy that is not the organization's as not found, without listing", async () => {
    getJobMock.mockResolvedValue(null);
    await expect(render({ job })).rejects.toThrow("NOT_FOUND");
    expect(listApplicantsMock).not.toHaveBeenCalled();
    expect(getJobMock).toHaveBeenCalledWith("org-1", job);
  });
});

describe("the list", () => {
  it("shows a row per applicant with the New badge on the applied one only, and the vacancy column without a vacancy", async () => {
    const html = await render();
    expect(html).toContain("Ana Silva");
    expect(html).toContain("Ben Okoro");
    expect(html.match(/>New</g)).toHaveLength(1);
    expect(html).toContain(">Vacancy<");
    expect(html).toContain("All vacancies of Acme Bau");
    expect(html).not.toContain("Export CSV");
    expect(html).not.toContain(">Board<");
  });

  it("reads the organization's applicants with the parsed query and never the board", async () => {
    await render({ sort: "password", page: "0", stage: "hacked" });
    expect(listApplicantsMock).toHaveBeenCalledWith("org-1", { job: null, view: "list", sort: "applied", dir: "desc", stage: null, page: 1 });
    expect(listBoardMock).not.toHaveBeenCalled();
  });

  it("marks the sorted header, offers the export and the board for one vacancy, and links to the vacancy", async () => {
    const html = await render({ job, sort: "stage", dir: "asc" });
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('aria-label="Sort by Stage"');
    expect(html).toContain('href="/en/org/acme-bau/applicants?job=' + job + '&amp;sort=stage&amp;dir=desc"');
    expect(html).toContain("Export CSV");
    expect(html).toContain('name="job"');
    expect(html).toContain('action="/en/org/acme-bau/applicants/export"');
    expect(html).toContain(">Board<");
    expect(html).toContain(`href="/en/org/acme-bau/jobs/${job}"`);
    expect(html).not.toContain(">Vacancy<");
    expect(html).not.toMatch(/Export CSV<\/button>[^]*disabled/);
  });

  it("disables the export for a plan without it and says why the changes are off for a lapsed organization", async () => {
    getAccessMock.mockResolvedValue({ ...access, stageChangeBlocked: "read_only_free_plan", csvExportAvailable: false });
    const html = await render({ job });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Export CSV/);
    expect(html).toContain("disabled until a plan is chosen");
    expect(html).not.toContain("does not include the CSV export");
    expect(html).toContain("Ana Silva");
  });

  it("says why the export is off for a plan without it when the organization is not lapsed", async () => {
    getAccessMock.mockResolvedValue({ ...access, csvExportAvailable: false });
    const html = await render({ job });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="([^"]+)"[^>]*>Export CSV/);
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<p id="${id}" class="text-sm text-muted-foreground">Your plan does not include the CSV export.</p>`);
    expect(html).not.toContain("disabled until a plan is chosen");
  });

  it("shows no reason next to an export that is available", async () => {
    const html = await render({ job });
    expect(html).not.toContain("does not include the CSV export");
    expect(html).not.toContain("aria-describedby");
  });

  it("offers the sort by stage and by applied date for all the vacancies, and the other two columns as plain headers", async () => {
    const html = await render({ sort: "completeness" });
    expect(html).toContain('aria-label="Sort by Stage"');
    expect(html).toContain('aria-label="Sort by Applied date"');
    expect(html).not.toContain('aria-label="Sort by Completeness (%)"');
    expect(html).not.toContain('aria-label="Sort by Documents"');
    expect(html).toContain("Completeness (%)");
    expect(listApplicantsMock).toHaveBeenCalledWith("org-1", expect.objectContaining({ job: null, sort: "applied" }));
  });

  it("offers all four sorts for one vacancy, with the accessible name that contains the visible text", async () => {
    const html = await render({ job });
    for (const name of ["Sort by Stage", "Sort by Applied date", "Sort by Completeness (%)", "Sort by Documents"]) {
      expect(html).toContain(`aria-label="${name}"`);
    }
  });

  it("shows the empty state with a link to the vacancy and no export when there is no application", async () => {
    listApplicantsMock.mockResolvedValue({ rows: [], total: 0, page: 1 });
    const html = await render({ job });
    expect(html).toContain("No applications yet");
    expect(html).toContain("Back to the vacancy");
    expect(html).not.toContain("Export CSV");
    expect(html).not.toContain("FILTER");
  });

  it("shows no match with a Clear filter link when the filter matches nothing", async () => {
    listApplicantsMock.mockResolvedValue({ rows: [], total: 0, page: 1 });
    const html = await render({ job, stage: "offer" });
    expect(html).toContain("No applicants match this filter");
    expect(html).toContain('action="/en/org/acme-bau/applicants"');
    expect(html).toContain(`name="job" value="${job}"`);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Clear filter<\/button>/);
    expect(html.match(/<form action="\/en\/org\/acme-bau\/applicants">(.*?)<\/form>/)?.[1]).not.toContain('name="stage"');
    expect(html).not.toContain("No applications yet");
  });

  it("pages by 50 and links the neighbours with the sort and the filter kept", async () => {
    listApplicantsMock.mockResolvedValue({ rows: [row("a1", "Ana Silva")], total: 120, page: 2 });
    const html = await render({ job, stage: "applied", page: "2" });
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain(`href="/en/org/acme-bau/applicants?job=${job}&amp;stage=applied"`);
    expect(html).toContain(`href="/en/org/acme-bau/applicants?job=${job}&amp;stage=applied&amp;page=3"`);
  });

  it("shows the last page when the address asks for a later one", async () => {
    listApplicantsMock.mockResolvedValue({ rows: [row("a1", "Ana Silva")], total: 51, page: 2 });
    expect(await render({ job, page: "9" })).toContain("Page 2 of 2");
  });
});

describe("the board", () => {
  const columns = [{ status: "applied", total: 2, rows: [row("a1", "Ana Silva")] }];

  it("reads the board of the vacancy and not the list", async () => {
    listBoardMock.mockResolvedValue(columns);
    const html = await render({ job, view: "board" });
    expect(html).toContain("BOARD frozen=false");
    expect(listBoardMock).toHaveBeenCalledWith("org-1", job);
    expect(listApplicantsMock).not.toHaveBeenCalled();
    expect(html).not.toContain("Export CSV");
  });

  it("freezes the board of a lapsed organization", async () => {
    listBoardMock.mockResolvedValue(columns);
    getAccessMock.mockResolvedValue({ ...access, stageChangeBlocked: "read_only_free_plan" });
    expect(await render({ job, view: "board" })).toContain("BOARD frozen=true");
  });

  it("falls back to the list when there is no vacancy", async () => {
    await render({ view: "board" });
    expect(listBoardMock).not.toHaveBeenCalled();
    expect(listApplicantsMock).toHaveBeenCalled();
  });

  it("shows the empty state for a vacancy with no application", async () => {
    listBoardMock.mockResolvedValue([{ status: "applied", total: 0, rows: [] }]);
    expect(await render({ job, view: "board" })).toContain("No applications yet");
  });
});

describe("the bulk actions of the applicants page", () => {
  it("offers a box per applicant and the toolbar, with the plan's shortlisting and the note limit", async () => {
    getAccessMock.mockResolvedValue({ ...access, shortlistingAvailable: false, noteMaxChars: 900 });
    const html = await render({ job });
    expect(html).toContain("TOOLBAR acme-bau shortlisting=false note=900");
    expect(html).toContain('aria-label="Select Ana Silva"');
    expect(html).toContain('aria-label="Select Ben Okoro"');
    expect(html).toContain('type="checkbox"');
  });

  it("names a former candidate's box as such", async () => {
    listApplicantsMock.mockResolvedValue({ rows: [row("a1", null)], total: 1, page: 1 });
    expect(await render({ job })).toContain('aria-label="Select Former candidate"');
  });

  it("offers the toolbar on the board", async () => {
    listBoardMock.mockResolvedValue([{ status: "applied", total: 1, rows: [row("a1", "Ana Silva")] }]);
    expect(await render({ job, view: "board" })).toContain("TOOLBAR acme-bau");
  });

  it("offers neither boxes nor toolbar to a lapsed organization", async () => {
    getAccessMock.mockResolvedValue({ ...access, stageChangeBlocked: "read_only_free_plan" });
    const html = await render({ job });
    expect(html).not.toContain("TOOLBAR");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain(">Select<");
  });

  it("offers neither boxes nor toolbar when there is no application", async () => {
    listApplicantsMock.mockResolvedValue({ rows: [], total: 0, page: 1 });
    expect(await render({ job })).not.toContain("TOOLBAR");
  });
});
