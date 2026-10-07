import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCandidateMock = vi.hoisted(() => vi.fn());
const listMyApplicationsMock = vi.hoisted(() => vi.fn());
const getMyApplicationMock = vi.hoisted(() => vi.fn());
const listTimelineMock = vi.hoisted(() => vi.fn());
const logTrackerViewMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/dal/session", () => ({ requireCandidate: requireCandidateMock }));
vi.mock("@/lib/dal/applications", () => ({
  listMyApplications: listMyApplicationsMock,
  getMyApplication: getMyApplicationMock,
  listTimeline: listTimelineMock,
}));
vi.mock("@/lib/applications/tracker-log", () => ({ logTrackerView: logTrackerViewMock }));

const { default: ApplicationsPage } = await import("@/app/[lang]/(app)/applications/page");
const { default: ApplicationPage } = await import("@/app/[lang]/(app)/applications/[id]/page");

const id = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const listProps = (search: Record<string, string> = {}) =>
  ({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve(search) }) as Parameters<typeof ApplicationsPage>[0];
const pageProps = (applicationId: string) =>
  ({ params: Promise.resolve({ lang: "en", id: applicationId }), searchParams: Promise.resolve({}) }) as Parameters<typeof ApplicationPage>[0];

const detail = {
  id,
  jobId: "0a7e4c1b-2d3f-4b5a-8c9d-1e2f3a4b5c6d",
  jobTitle: "Welder",
  employerName: "Acme",
  status: "shortlisted",
  appliedAt: "2026-10-03T10:00:00Z",
  vacancyIsOpen: true,
  coverNote: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireCandidateMock.mockResolvedValue(undefined);
  listMyApplicationsMock.mockResolvedValue({ applications: [], hasNext: false });
  getMyApplicationMock.mockResolvedValue(detail);
  listTimelineMock.mockResolvedValue([]);
});

describe("the tracker view log (KPI: tracker visits per application)", () => {
  it("logs one view of the list when the list is shown", async () => {
    await ApplicationsPage(listProps());
    expect(logTrackerViewMock.mock.calls).toEqual([["list"]]);
  });

  it("logs one view of an application when its page is shown", async () => {
    await ApplicationPage(pageProps(id));
    expect(logTrackerViewMock.mock.calls).toEqual([["application"]]);
  });

  it("logs nothing for an application that is not the candidate's", async () => {
    getMyApplicationMock.mockResolvedValue(null);
    await expect(ApplicationPage(pageProps(id))).rejects.toThrow("NOT_FOUND");
    expect(logTrackerViewMock).not.toHaveBeenCalled();
  });
});

describe("the note of a timeline event", () => {
  it("names who wrote it: the employer's message is not shown as the candidate's note, and the other way round", async () => {
    listTimelineMock.mockResolvedValue([
      { toStatus: "shortlisted", note: "From the employer", createdAt: "2026-10-04T10:00:00Z", actorRole: "employer" },
      { toStatus: "shortlisted", note: "From the candidate", createdAt: "2026-10-05T10:00:00Z", actorRole: "you" },
      { toStatus: "shortlisted", note: "From the platform", createdAt: "2026-10-06T10:00:00Z", actorRole: "system" },
    ]);
    const html = renderToStaticMarkup(await ApplicationPage(pageProps(id)));
    const items = html.split("<li").slice(1);
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("Message from the employer");
    expect(items[0]).toContain("From the employer");
    expect(items[1]).toContain("Your note");
    expect(items[1]).not.toContain("Message from the employer");
    expect(items[2]).toContain(">Note<");
    expect(items[2]).not.toContain("Message from the employer");
  });
});
