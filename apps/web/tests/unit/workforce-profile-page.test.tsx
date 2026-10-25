import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const commitmentMock = vi.hoisted(() => vi.fn());
const licencesMock = vi.hoisted(() => vi.fn());
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
  getOccupations: async () => [
    { code: "7126", label: "Plumbers and pipe fitters", synonyms: [] },
    { code: "7212", label: "Welders and flame cutters", synonyms: ["welder"] },
  ],
  getIndustries: async () => [
    { code: "C", name: "Manufacturing" },
    { code: "F", name: "Construction" },
  ],
  getLanguages: async () => [
    { code: "ar", name: "Arabic" },
    { code: "en", name: "English" },
  ],
}));
vi.mock("@/lib/actions/geographies", () => ({ saveOrganizationGeographies: vi.fn() }));
vi.mock("@/lib/dal/workforce-offer", async () => ({
  ...(await vi.importActual<typeof import("@/lib/dal/workforce-offer")>("@/lib/dal/workforce-offer")),
  getWorkforceOffer: async () => ({
    occupations: ["7212"],
    industries: ["C", "F"],
    languages: ["ar"],
    recruitmentType: "international",
    serviceTypes: ["staffing", "temporary"],
    sizeBand: "50_249",
    foundedYear: 2019,
  }),
  getOccupationsLimit: async () => 10,
}));
vi.mock("@/lib/actions/workforce-offer", () => ({ saveWorkforceOffer: vi.fn() }));
vi.mock("@/lib/dal/commitment", () => ({ getCommitmentStatus: commitmentMock }));
vi.mock("@/lib/dal/licences", () => ({
  getPartnerLicences: licencesMock,
  getLicenceSettings: async () => ({ patterns: {}, maxYears: 20 }),
}));
vi.mock("@/lib/actions/licences", () => ({ saveLicence: vi.fn(), deleteLicence: vi.fn(), startEvidenceUpload: vi.fn() }));

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
  commitmentMock.mockResolvedValue({ version: 1, isDraft: false, accepted: true, acceptedVersion: 1 });
  licencesMock.mockResolvedValue([]);
});

describe("the workforce profile page (FR-K1, FR-K2)", () => {
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

  it("lets the owner change what the company offers, with the saved values filled in (FR-K2 AC1, AC7, AC10)", async () => {
    requireOrgRoleMock.mockResolvedValue(organization("owner", "recruitment_company"));
    const html = await render();
    expect(html).toContain(">What you offer</h2>");
    expect(html).toContain('aria-label="Remove Welders and flame cutters"');
    expect(html).toContain(">1 of 10 occupations</p>");
    expect(html).toContain('aria-label="Remove Manufacturing"');
    expect(html).toContain('aria-label="Remove Arabic"');
    expect(html).toMatch(/<legend[^>]*>Recruitment type<\/legend>/);
    expect(html).toMatch(/<input[^>]*type="radio"[^>]*checked="" value="international"/);
    expect(html).toContain("We also supply staff (staffing)");
    expect(html).toMatch(/<legend[^>]*>Staffing types \(choose at least one\)<\/legend>/);
    expect(html).toMatch(/<option value="50_249" selected="">50 to 249 people<\/option>/);
    expect(html).toMatch(/<input[^>]*value="2019"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save what you offer<\/button>/);
  });

  it("shows a member the countries without a form", async () => {
    requireOrgRoleMock.mockResolvedValue(organization("member", "recruitment_company"));
    const html = await render();
    expect(html).not.toContain("<form");
    expect(html).toMatch(/<dt[^>]*>Where do you source workers from\?<\/dt><dd[^>]*>Nepal, Philippines<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Where do you recruit for\?<\/dt><dd[^>]*>Germany<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Occupations<\/dt><dd[^>]*>Welders and flame cutters<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Industries<\/dt><dd[^>]*>Manufacturing, Construction<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Recruitment type<\/dt><dd[^>]*>International<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Staffing types<\/dt><dd[^>]*>Temporary<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Year founded<\/dt><dd[^>]*>2019<\/dd>/);
  });

  it("says a suspended partner's details are not available", async () => {
    requireOrgRoleMock.mockResolvedValue(organization("owner", "staffing_company", true));
    expect(await render()).toContain("This organization is suspended, so its details are not available.");
  });

  it("says nothing about the commitment while the current version is accepted", async () => {
    const html = await render();
    expect(html).not.toContain("commitment");
    expect(commitmentMock).toHaveBeenCalledWith("org-1");
  });

  it("FR-J3: leads the owner to accept an outdated commitment and tells an admin and a member what waits on it", async () => {
    commitmentMock.mockResolvedValue({ version: 2, isDraft: false, accepted: false, acceptedVersion: 1 });
    let html = await render();
    expect(html).toMatch(/<div[^>]*role="status"[^>]*>.*The employer-pays commitment has changed\. Accept the updated version/);
    expect(html).toMatch(/<a[^>]*href="\/en\/onboarding"[^>]*>Review and accept the commitment<\/a>/);

    for (const role of ["admin", "member"]) {
      requireOrgRoleMock.mockResolvedValue(organization(role));
      html = await render();
      expect(html).toMatch(
        /<div[^>]*role="status"[^>]*>.*Your owner needs to accept the updated commitment before you can respond to job orders or submit candidates\./,
      );
      expect(html).not.toContain("Review and accept the commitment");
    }
  });

  it("FR-J3: asks for the commitment after a transfer of ownership, when the new owner has accepted no version", async () => {
    commitmentMock.mockResolvedValue({ version: 2, isDraft: false, accepted: false, acceptedVersion: null });
    let html = await render();
    expect(html).toContain("Accept the employer-pays commitment before your company can respond to job orders or submit candidates.");
    requireOrgRoleMock.mockResolvedValue(organization("member"));
    html = await render();
    expect(html).toContain("Your owner needs to accept the employer-pays commitment before you can respond to job orders");
  });
});

const licence = (id: string, country: string, status: "current" | "expired", validUntil: string) => ({
  id,
  country,
  issuingAuthority: "Department of Migrant Workers",
  licenceNumber: `DMW-${id}`,
  validUntil,
  status,
  evidence: id === "a" ? { mime: "application/pdf", sizeBytes: 2_097_152, status: "skipped" } : null,
});

describe("the licences of the workforce profile page (FR-J2)", () => {
  it("AC11: shows the owner the empty state with the button that adds the first licence", async () => {
    const html = await render();
    expect(html).toContain(">Licences</h2>");
    expect(html).toContain("No licences added yet");
    expect(html).toMatch(/<button[^>]*>Add a licence<\/button>/);
    expect(licencesMock).toHaveBeenCalledWith("org-1");
  });

  it("AC1, AC11: lists the entries as given, the expired one marked, each seen only by staff", async () => {
    licencesMock.mockResolvedValue([
      licence("b", "DE", "expired", "2026-10-01"),
      licence("a", "PH", "current", "2028-03-15"),
    ]);
    const html = await render();
    expect(html.indexOf(">Germany</h3>")).toBeLessThan(html.indexOf(">Philippines</h3>"));
    expect(html).toMatch(/>Germany<\/h3><span[^>]*>Expired<\/span>/);
    expect(html).toContain(">DMW-a</dd>");
    expect(html).toContain(">15 March 2028</dd>");
    expect(html).toContain(">2 MB - File received</dd>");
    expect(html.match(/Seen only by Chara Pinnacle staff until verification is available<\/p>/g)).toHaveLength(2);
    expect(html).toContain("Edit<span class=\"sr-only\"> the licence for Philippines</span>");
    expect(html).toContain("Delete<span class=\"sr-only\"> the licence for Germany</span>");
  });

  it("AC4: shows a member the entries without any button that changes them", async () => {
    requireOrgRoleMock.mockResolvedValue(organization("member", "recruitment_company"));
    licencesMock.mockResolvedValue([licence("a", "PH", "current", "2028-03-15")]);
    const html = await render();
    expect(html).toContain(">DMW-a</dd>");
    expect(html).not.toContain("Add a licence");
    expect(html).not.toContain("Edit<span");
    licencesMock.mockResolvedValue([]);
    expect(await render()).toContain("Your owner or an administrator adds the licences of your company.");
  });
});
