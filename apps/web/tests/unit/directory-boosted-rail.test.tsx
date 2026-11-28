import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

const releasedMock = vi.hoisted(() => vi.fn());
const railMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/organizations", () => ({ isEmployerMember: async () => false }));
vi.mock("@/lib/dal/reference", () => ({
  getOccupations: async () => [],
  getIndustries: async () => [],
  getCountries: async () => [],
  getLanguages: async () => [],
  getAgencyWorkRules: async () => [],
}));
vi.mock("@/components/partners/partner-search-form", () => ({ PartnerSearchForm: () => <form aria-label="Search" /> }));
vi.mock("@/components/partners/available-workforce-search", () => ({ AvailableWorkforceSearch: () => null }));
vi.mock("@/components/compliance/agency-work-notice", () => ({ AgencyWorkNotice: () => null }));
vi.mock("@/components/partners/partner-results", () => ({
  PartnerResults: ({ kind }: { kind: string }) => <p>Organic {kind} results</p>,
}));
vi.mock("@/components/boosts/boosted-rail", () => ({
  BoostedRail: (props: { kind: string; filters: Record<string, unknown> }) => {
    railMock(props);
    return <p>Boosted {props.kind} rail</p>;
  },
}));

const { default: RecruitmentPage } = await import("@/app/[lang]/(public)/partners/recruitment/page");
const { default: StaffingPage } = await import("@/app/[lang]/(public)/partners/staffing/page");

async function render(kind: "recruitment" | "staffing", searchParams: Record<string, string> = {}) {
  const props = { params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve(searchParams) };
  const element = kind === "recruitment" ? await RecruitmentPage(props) : await StaffingPage(props);
  const { prelude } = await prerender(element);
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
});

describe("the Boosted rail in the partner directories", () => {
  it.each(["recruitment", "staffing"] as const)("shows the %s rail above the organic results, with the same filters", async (kind) => {
    const html = await render(kind, { occupation: "7212" });
    expect(html).toContain(`Boosted ${kind} rail`);
    expect(html.indexOf(`Boosted ${kind} rail`)).toBeLessThan(html.indexOf(`Organic ${kind} results`));
    expect(railMock).toHaveBeenCalledWith(expect.objectContaining({ kind, filters: expect.objectContaining({ occupation: "7212" }) }));
  });

  it.each(["recruitment", "staffing"] as const)("shows no %s rail while the boosts are off", async (kind) => {
    releasedMock.mockImplementation((key: string) => Promise.resolve(key !== "release_boosts"));
    const html = await render(kind);
    expect(html).not.toContain("Boosted");
    expect(html).toContain("results");
    expect(railMock).not.toHaveBeenCalled();
  });
});
