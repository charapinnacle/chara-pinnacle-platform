import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/organizations", () => ({ getOrganizationProfile: async () => ({ country: "PH" }) }));
vi.mock("@/lib/dal/geographies", () => ({
  getOrganizationGeographies: async () => ({ sourcesFrom: ["NP", "PH"], servesMarket: ["DE"] }),
  getMarketsLimit: async () => 3,
}));
vi.mock("@/lib/dal/reference", () => ({
  getCountries: async () => [
    { code: "DE", name: "Germany" },
    { code: "NP", name: "Nepal" },
    { code: "PH", name: "Philippines" },
  ],
}));
vi.mock("@/lib/actions/geographies", () => ({ saveOrganizationGeographies: vi.fn() }));

const { default: WorkforceProfilePage } = await import("@/app/[lang]/(app)/org/[slug]/workforce-profile/page");

async function render() {
  const page = await WorkforceProfilePage({
    params: Promise.resolve({ lang: "en", slug: "manila-skills" }),
    searchParams: Promise.resolve({}),
  });
  const { prelude } = await prerender(page);
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}

const organization = (role: string, type = "staffing_company", suspended = false) => ({
  organization: { id: "org-1", slug: "manila-skills", displayName: "Manila Staff", type, role, suspended },
});

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue(organization("owner"));
});

describe("the workforce profile page (FR-K1)", () => {
  it("does not exist while release 2a is off", async () => {
    releasedMock.mockResolvedValue(false);
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
  });

  it("opens to the members of a partner only, owners and admins at aal2", async () => {
    await render();
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "member", { hideFromOutsiders: true, partner: true });
  });

  it("lets the owner change the countries, with the saved ones as chips, the limit and the billing link target", async () => {
    const html = await render();
    expect(html).toContain(">Workforce profile</h1>");
    expect(html).toContain(">Where you serve</h2>");
    expect(html).toMatch(/<dd[^>]*>Philippines<\/dd>/);
    expect(html).toContain('aria-label="Remove Nepal"');
    expect(html).toContain('aria-label="Remove Germany"');
    expect(html).toContain("Where do you supply workers for?");
    expect(html).toContain(">1 of 3 countries</p>");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save countries<\/button>/);
  });

  it("shows a member the countries without a form", async () => {
    requireOrgRoleMock.mockResolvedValue(organization("member", "recruitment_company"));
    const html = await render();
    expect(html).not.toContain("<form");
    expect(html).toMatch(/<dt[^>]*>Where do you source workers from\?<\/dt><dd[^>]*>Nepal, Philippines<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Where do you recruit for\?<\/dt><dd[^>]*>Germany<\/dd>/);
  });

  it("says a suspended partner's details are not available", async () => {
    requireOrgRoleMock.mockResolvedValue(organization("owner", "staffing_company", true));
    expect(await render()).toContain("This organization is suspended, so its details are not available.");
  });
});
