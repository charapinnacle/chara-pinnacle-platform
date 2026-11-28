import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const currentUserMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const runMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock, getCurrentUser: currentUserMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/chara-match", () => ({ getMatchRun: runMock, listMatches: listMock }));
vi.mock("@/lib/actions/chara-match", () => ({ runCharaMatch: vi.fn() }));
vi.mock("@/lib/dal/reference", () => ({
  getOccupations: async () => [{ code: "7212", label: "Welders and flame cutters", synonyms: [] }],
  getIndustries: async () => [{ code: "F", name: "Construction" }],
  getCountries: async () => [
    { code: "DE", name: "Germany" },
    { code: "PH", name: "Philippines" },
    { code: "NP", name: "Nepal" },
  ],
  getLanguages: async () => [{ code: "de", name: "German" }],
}));

const { default: CharaMatchPage } = await import("@/app/[lang]/(app)/org/[slug]/match/page");
const { RequirementCharaMatch } = await import("@/components/requirements/requirement-chara-match");

const RUN = "33333333-3333-4333-8333-333333333333";
const PARTNER = "44444444-4444-4444-8444-444444444444";
const run = {
  id: RUN,
  createdAt: "2027-03-06T10:00:00+00:00",
  inputs: { destination: "DE", industry: "F", occupation: "7212", workers: "20", start: "2027-05-01", recruitment: "international" },
  summary: {
    matchingWorkers: null,
    workersFewerThan: 5,
    recruitmentPartners: 2,
    staffingPartners: 1,
    availableWorkforce: "25–49",
    sourceCountries: [{ code: "PH", name: "Philippines" }],
  },
};
const card = {
  card_id: "22222222-2222-4222-8222-222222222222",
  headline: "MIG welder",
  occupation_id: "7212",
  skills: ["Welding"],
  years_experience: 6,
  languages: [{ code: "de", level: "B2" as const }],
  availability: "now" as const,
  available_from: null,
  current_country: "NP",
  preferred_countries: ["DE"],
  work_authorization_countries: [],
  training: null,
  employment_history: null,
  preferred_industries: null,
  preferred_employment_types: null,
  updated_at: "2027-02-09T10:00:00+00:00",
};

const clean = (html: string) => html.replace(/<!-- -->|<!--\/?\$-->/g, "");

async function render(searchParams: Record<string, string> = {}, role = "member"): Promise<string> {
  requireOrgRoleMock.mockResolvedValue({
    user: { id: "u1" },
    organization: { id: "org-1", slug: "acme", displayName: "Acme Bau", type: "employer", role, suspended: false },
  });
  const page = await CharaMatchPage({
    params: Promise.resolve({ lang: "en", slug: "acme" }),
    searchParams: Promise.resolve(searchParams),
  });
  const { prelude } = await prerender(page);
  return clean(await new Response(prelude).text());
}

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  currentUserMock.mockResolvedValue({ id: "u1" });
  runMock.mockResolvedValue(run);
  listMock.mockResolvedValue({ state: "found", matches: [], nextCursor: null });
});

describe("the CHARA Match page (section 9.3, brief section 7)", () => {
  it("does not exist while CHARA Match or the partner directories are off, or for a visitor", async () => {
    releasedMock.mockImplementation(async (name: string) => name !== "release_chara_match");
    await expect(render()).rejects.toThrow("NOT_FOUND");
    releasedMock.mockImplementation(async (name: string) => name !== "release_partner_directories");
    await expect(render()).rejects.toThrow("NOT_FOUND");
    releasedMock.mockResolvedValue(true);
    currentUserMock.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
  });

  it("opens the form for any member, prefilled from the address, without a summary", async () => {
    const html = await render({ destination: "DE", occupation: "7212", workers: "12", recruitment: "both" });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme", "member", { mfa: false, hideFromOutsiders: true });
    expect(html).toContain("<h1");
    expect(html).toContain("CHARA Match");
    for (const label of ["Destination country", "Industry", "Occupation", "Number of workers", "Start date", "Recruitment type"]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/id="match-workers"[^>]*value="12"|value="12"[^>]*id="match-workers"/);
    expect(html).toContain("Find matches");
    expect(html).not.toContain("Potential workforce network");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("shows the potential workforce network of a run, with View matches and the disclaimer", async () => {
    listMock.mockResolvedValue({ state: "found", matches: [], nextCursor: null });
    const html = await render({ run: RUN });
    expect(runMock).toHaveBeenCalledWith("org-1", RUN);
    expect(html).toContain("Potential workforce network");
    for (const text of [
      "Fewer than 5 matching workers",
      "2 recruitment partners",
      "1 staffing partner",
      "25–49 workers listed as available by these partners",
      "Available source countries: Philippines",
      "not a guarantee",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain(`href="/en/org/acme/match?run=${RUN}&amp;view=workers"`);
    expect(html).not.toMatch(/success guaranteed|AI/);
  });

  it("says a run that is gone and keeps the form", async () => {
    runMock.mockResolvedValue(null);
    const html = await render({ run: RUN });
    expect(html).toContain("This match is no longer available.");
    expect(html).not.toContain("Potential workforce network");
  });

  it("lists the partner matches with why each matched and a link to the profile", async () => {
    listMock.mockResolvedValue({
      state: "found",
      matches: [
        {
          kind: "partner",
          id: PARTNER,
          score: 90,
          reasons: [
            { rule: "serves_destination", points: 35, detail: "DE" },
            { rule: "sources_from", points: 15, detail: "PH" },
          ],
          slug: "manila",
          displayName: "Manila Skills",
          recruitmentCompany: true,
        },
      ],
      nextCursor: `90|${PARTNER}`,
    });
    const html = await render({ run: RUN, view: "recruitment" });
    expect(listMock).toHaveBeenCalledWith(RUN, "recruitment_partner", undefined);
    expect(html).toContain('href="/en/partners/manila"');
    expect(html).toContain("Manila Skills");
    expect(html).toContain("Match score 90 of 100");
    expect(html).toContain("Why this match");
    expect(html).toContain("Serves Germany");
    expect(html).toContain("Sources workers from Philippines");
    expect(html).toContain("35 points");
    expect(html).toContain("Recruitment partners (2)");
    expect(html).toContain("Workers (&lt;5)");
    expect(html).toContain(`href="/en/org/acme/match?run=${RUN}&amp;view=recruitment&amp;cursor=90%7C${PARTNER}"`);
  });

  it("shows the worker matches as Find Workers cards only while Find Workers is released", async () => {
    releasedMock.mockImplementation(async (name: string) => name !== "release_find_workers");
    const off = await render({ run: RUN, view: "workers" });
    expect(off).toContain("can be viewed once worker search is available");
    expect(listMock).not.toHaveBeenCalled();

    releasedMock.mockResolvedValue(true);
    listMock.mockResolvedValue({
      state: "found",
      matches: [
        {
          kind: "worker",
          id: card.card_id,
          score: 80,
          reasons: [
            { rule: "occupation", points: 40, detail: "7212" },
            { rule: "preferred_country", points: 10, detail: "DE" },
          ],
          card,
          directContact: "allowed",
          notice: "",
        },
      ],
      nextCursor: null,
    });
    const on = await render({ run: RUN, view: "workers" });
    expect(on).toContain('data-testid="worker-card"');
    expect(on).toContain("MIG welder");
    expect(on).toContain("Works as Welders and flame cutters");
    expect(on).toContain("Wants to work in Germany");
    expect(on).not.toContain("Zebulon");
  });

  it("says a used-up limit and a refused list", async () => {
    listMock.mockResolvedValue({ state: "rate_limited" });
    expect(await render({ run: RUN, view: "staffing" })).toContain("Too many searches");
    listMock.mockResolvedValue({ state: "unavailable" });
    expect(await render({ run: RUN, view: "staffing" })).toContain("These matches are not available for this organisation.");
  });
});

describe("Find matches on a workforce requirement", () => {
  it("opens CHARA Match with what the requirement asks for, leaving a past start out", async () => {
    const requirement = {
      countryCode: "DE",
      industryCode: "F",
      occupations: [{ code: "7212", label: "Welders", quantity: 12 }],
      workersNeeded: 20,
      startDate: "2027-05-01",
      recruitmentPreference: "international",
    } as unknown as Parameters<typeof RequirementCharaMatch>[0]["requirement"];
    const { prelude } = await prerender(<RequirementCharaMatch lang="en" slug="acme" requirement={requirement} today="2027-03-06" />);
    const html = await new Response(prelude).text();
    expect(html).toContain(
      'href="/en/org/acme/match?destination=DE&amp;industry=F&amp;occupation=7212&amp;workers=12&amp;start=2027-05-01&amp;recruitment=international"',
    );
    const { prelude: late } = await prerender(<RequirementCharaMatch lang="en" slug="acme" requirement={requirement} today="2027-06-01" />);
    expect(await new Response(late).text()).not.toContain("start=");
  });
});
