import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);
const roleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: roleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/connections", () => ({ listSavedPartners: listMock }));

const { default: SavedPartnersPage } = await import("@/app/[lang]/(app)/org/[slug]/saved-partners/page");

const props = { params: Promise.resolve({ lang: "en", slug: "manila" }), searchParams: Promise.resolve({}) } as Parameters<
  typeof SavedPartnersPage
>[0];
const organization = (type: string) => ({ id: "org-1", slug: "manila", displayName: "Manila", type, role: "member", suspended: false });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  listMock.mockResolvedValue({ partners: [], total: 0, nextCursor: null });
});

// FR-L4 roles: only employers save partners, so the page of a partner organisation does not exist.
describe("the saved partners page", () => {
  it("is not found for a partner organisation, without reading any save", async () => {
    roleMock.mockResolvedValue({ organization: organization("recruitment_company") });
    await expect(SavedPartnersPage(props)).rejects.toThrow("NOT_FOUND");
    expect(roleMock).toHaveBeenCalledWith("en", "manila", "member", { hideFromOutsiders: true, partner: "either" });
    expect(listMock).not.toHaveBeenCalled();
  });

  it("lists the saves of an employer", async () => {
    roleMock.mockResolvedValue({ organization: organization("employer") });
    await SavedPartnersPage(props);
    expect(listMock).toHaveBeenCalledWith("org-1", null);
  });

  it("is not found while release 2a is off", async () => {
    releasedMock.mockResolvedValue(false);
    await expect(SavedPartnersPage(props)).rejects.toThrow("NOT_FOUND");
    expect(roleMock).not.toHaveBeenCalled();
  });
});
