import { beforeEach, describe, expect, it, vi } from "vitest";

const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);
const roleMock = vi.hoisted(() => vi.fn());
const appealMock = vi.hoisted(() => vi.fn());
const jobMock = vi.hoisted(() => vi.fn());
const reviewMock = vi.hoisted(() => vi.fn());
const reportMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());
const userMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/dal/session", () => ({ requirePlatformRole: roleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: async () => true }));
vi.mock("@/lib/dal/admin-appeals", () => ({ getAppeal: appealMock }));
vi.mock("@/lib/dal/admin-jobs", () => ({ getModerationJob: jobMock }));
vi.mock("@/lib/dal/admin-partner-reviews", () => ({ getPartnerReviewDetail: reviewMock }));
vi.mock("@/lib/dal/admin-reports", () => ({ getReport: reportMock }));
vi.mock("@/lib/dal/admin", () => ({ getOrganization: organizationMock, getUser: userMock }));

const ID = "00000000-0000-4000-8000-000000000001";
const pages = [
  ["appeals", "42", appealMock, () => import("@/app/[lang]/(admin)/admin/appeals/[id]/page")],
  ["moderation", ID, jobMock, () => import("@/app/[lang]/(admin)/admin/moderation/[id]/page")],
  ["partners", ID, reviewMock, () => import("@/app/[lang]/(admin)/admin/partners/[id]/page")],
  ["reports", "42", reportMock, () => import("@/app/[lang]/(admin)/admin/reports/[id]/page")],
  ["organizations", ID, organizationMock, () => import("@/app/[lang]/(admin)/admin/organizations/[id]/page")],
  ["users", ID, userMock, () => import("@/app/[lang]/(admin)/admin/users/[id]/page")],
] as const;

type DetailPage = (props: { params: Promise<{ lang: string; id: string }> }) => Promise<unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  roleMock.mockResolvedValue({ roles: ["admin", "trust_safety"] });
});

// An unknown id answers 404 before the Suspense boundary of the view, so the status is not already 200 (streaming).
describe("the admin detail pages", () => {
  it.each(pages)("%s: an unknown id is not found before anything streams", async (_name, id, detailMock, load) => {
    const page = (await load()).default as DetailPage;
    detailMock.mockResolvedValue(null);
    await expect(page({ params: Promise.resolve({ lang: "en", id }) })).rejects.toThrow("NOT_FOUND");
    expect(detailMock).toHaveBeenCalledTimes(1);

    detailMock.mockResolvedValue({ id });
    await expect(page({ params: Promise.resolve({ lang: "en", id }) })).resolves.toBeTruthy();
  });
});
