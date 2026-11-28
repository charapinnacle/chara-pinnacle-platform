import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchingWorkersText, partnersText, reasonText } from "@/lib/chara-match/presentation";
import { charaMatchFormSchema, charaMatchPrefill, charaMatchQuery, toCharaMatchArgs } from "@/lib/validation/chara-match";

const rpcMock = vi.hoisted(() => vi.fn());
const maybeSingleMock = vi.hoisted(() => vi.fn());
const eqMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const logFaultMock = vi.hoisted(() => vi.fn(() => "ref-1"));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/fault", () => ({ logFault: logFaultMock, faultMessage: (reference: string) => `Something went wrong (${reference})` }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const query = { select: () => query, eq: (...args: unknown[]) => (eqMock(...args), query), maybeSingle: maybeSingleMock };
    return { rpc: rpcMock, from: () => query };
  },
}));

const { getMatchRun, listMatches } = await import("@/lib/dal/chara-match");
const { runCharaMatch } = await import("@/lib/actions/chara-match");

const TODAY = "2027-03-06";
const RUN = "33333333-3333-4333-8333-333333333333";
const PARTNER = "44444444-4444-4444-8444-444444444444";
const input = { destination: "de", industry: "f", occupation: "7212", workers: "20", start: "2027-05-01", recruitment: "international" };
const names = {
  countries: { DE: "Germany", PH: "Philippines", NP: "Nepal" },
  occupations: { "7212": "Welders and flame cutters" },
  industries: { F: "Construction" },
};
const summary = {
  matching_workers: null,
  workers_fewer_than: 5,
  recruitment_partners: 2,
  staffing_partners: 1,
  available_workforce: "25–49",
  source_countries: [{ code: "PH", name: "Philippines" }],
};
const card = {
  card_id: "22222222-2222-4222-8222-222222222222",
  headline: "MIG welder",
  occupation_id: "7212",
  skills: ["Welding"],
  years_experience: 6,
  languages: [{ code: "de", level: "B2" }],
  availability: "now",
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
const reasons = [
  { rule: "serves_destination", points: 35, detail: "DE" },
  { rule: "occupation", points: 20, detail: "7212" },
];

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue({ organization: { id: "org-1", slug: "acme", type: "employer", role: "member" } });
});

describe("the CHARA Match form (section 9.3, brief section 7)", () => {
  it("accepts what the employer needs and converts it to the arguments of chara_match", () => {
    const parsed = charaMatchFormSchema(TODAY).parse(input);
    expect(toCharaMatchArgs(parsed)).toEqual({
      p_destination: "DE",
      p_industry: "F",
      p_occupation: "7212",
      p_workers: 20,
      p_start: "2027-05-01",
      p_recruitment: "international",
    });
  });

  it.each([
    ["destination", "", "Select a country from the list."],
    ["industry", "12", "Select an industry from the list."],
    ["occupation", "welder", "Select an occupation from the list."],
    ["workers", "0", "Enter a whole number from 1 to 100,000."],
    ["workers", "", "Enter the number of workers."],
    ["start", "2027-03-05", "The start date cannot be in the past."],
    ["start", "2030-04-01", "Choose a start date within the next 3 years."],
    ["start", "", "Enter the start date."],
    ["recruitment", "", "Select a recruitment type."],
  ])("refuses %s %j", (field, value, message) => {
    const result = charaMatchFormSchema(TODAY).safeParse({ ...input, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues.find((issue) => issue.path[0] === field)?.message).toBe(message);
  });

  it("prefills only values of the right shape and builds the query of a link", () => {
    expect(charaMatchPrefill({ destination: "DE", industry: "F", occupation: "7212", workers: "12", start: "2027-05-01", recruitment: "both" })).toEqual({
      destination: "DE",
      industry: "F",
      occupation: "7212",
      workers: "12",
      start: "2027-05-01",
      recruitment: "both",
    });
    expect(charaMatchPrefill({ destination: "<script>", workers: ["1", "2"], recruitment: "anything" })).toEqual({
      destination: "",
      industry: "",
      occupation: "",
      workers: "",
      start: "",
      recruitment: "",
    });
    expect(charaMatchQuery({ destination: "DE", occupation: "7212", start: undefined })).toBe("destination=DE&occupation=7212");
  });
});

describe("Why this match", () => {
  it("says each rule in words, with the names of the codes", () => {
    expect(reasonText({ rule: "serves_destination", points: 35, detail: "DE" }, "recruitment_partner", names)).toBe("Serves Germany");
    expect(reasonText({ rule: "occupation", points: 20, detail: "7212" }, "staffing_partner", names)).toBe("Supplies Welders and flame cutters");
    expect(reasonText({ rule: "occupation", points: 40, detail: "7212" }, "worker", names)).toBe("Works as Welders and flame cutters");
    expect(reasonText({ rule: "sources_from", points: 15, detail: "NP,PH" }, "recruitment_partner", names)).toBe(
      "Sources workers from Nepal, Philippines",
    );
    expect(reasonText({ rule: "industry", points: 10, detail: "F" }, "recruitment_partner", names)).toBe("Works in Construction");
    expect(reasonText({ rule: "availability", points: 10, detail: "25–49" }, "recruitment_partner", names)).toBe(
      "25–49 workers listed as available by the start date",
    );
    expect(reasonText({ rule: "work_authorization", points: 25, detail: "DE" }, "worker", names)).toBe("May work in Germany");
    expect(reasonText({ rule: "preferred_country", points: 10, detail: "DE" }, "worker", names)).toBe("Wants to work in Germany");
    expect(reasonText({ rule: "availability", points: 15, detail: "now" }, "worker", names)).toBe("Available now");
    expect(reasonText({ rule: "language_level", points: 5, detail: "de" }, "worker", names)).toBe("language level");
  });

  it("says a worker count below k only as fewer than k", () => {
    expect(matchingWorkersText({ matchingWorkers: null, workersFewerThan: 5 })).toBe("Fewer than 5 matching workers");
    expect(matchingWorkersText({ matchingWorkers: 1820, workersFewerThan: null })).toBe("1,820 matching workers");
    expect(matchingWorkersText({ matchingWorkers: 0, workersFewerThan: null })).toBe("0 matching workers");
    expect(partnersText(1, "staffing")).toBe("1 staffing partner");
    expect(partnersText(23, "recruitment")).toBe("23 recruitment partners");
  });
});

describe("the CHARA Match data", () => {
  it("reads a run of the organisation with what was asked as the form's values", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: RUN,
        created_at: "2027-03-06T10:00:00+00:00",
        inputs: { destination: "DE", industry: "F", occupation: "7212", workers: 20, start: "2027-05-01", recruitment: "international" },
        summary,
      },
      error: null,
    });
    await expect(getMatchRun("org-1", RUN)).resolves.toEqual({
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
    });
    expect(eqMock).toHaveBeenCalledWith("organization_id", "org-1");
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    await expect(getMatchRun("org-1", RUN)).resolves.toBeNull();
  });

  it("pages the partner and worker matches with their reasons", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { entity_id: PARTNER, score: 55, reasons, slug: "manila", display_name: "Manila Skills", organization_type: "recruitment_company", card: null, next_cursor: `55|${PARTNER}` },
      ],
      error: null,
    });
    await expect(listMatches(RUN, "recruitment_partner", undefined)).resolves.toEqual({
      state: "found",
      matches: [{ kind: "partner", id: PARTNER, score: 55, reasons, slug: "manila", displayName: "Manila Skills", recruitmentCompany: true }],
      nextCursor: `55|${PARTNER}`,
    });
    expect(rpcMock).toHaveBeenCalledWith("chara_match_results", { p_run: RUN, p_entity_type: "recruitment_partner", p_cursor: undefined });

    rpcMock.mockResolvedValueOnce({
      data: [
        {
          entity_id: card.card_id,
          score: 80,
          reasons: [{ rule: "occupation", points: 40, detail: "7212" }],
          slug: null,
          display_name: null,
          organization_type: null,
          card: { ...card, direct_contact: "partner_required", notice: "A licensed partner is needed." },
          next_cursor: null,
        },
      ],
      error: null,
    });
    await expect(listMatches(RUN, "worker", undefined)).resolves.toMatchObject({
      state: "found",
      matches: [{ kind: "worker", id: card.card_id, card, directContact: "partner_required", notice: "A licensed partner is needed." }],
      nextCursor: null,
    });
  });

  it("turns the refusals into states and starts again without a broken cursor", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_RATE_LIMITED" } });
    await expect(listMatches(RUN, "worker", undefined)).resolves.toEqual({ state: "rate_limited" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_NOT_FOUND", code: "P0002" } });
    await expect(listMatches(RUN, "worker", undefined)).resolves.toEqual({ state: "unavailable" });
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: "CHARA_INVALID_INPUT", details: "p_cursor" } })
      .mockResolvedValueOnce({ data: [], error: null });
    await expect(listMatches(RUN, "staffing_partner", "bad")).resolves.toEqual({ state: "found", matches: [], nextCursor: null });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(listMatches(RUN, "staffing_partner", undefined)).rejects.toThrow("The matches could not be loaded");
  });
});

describe("runCharaMatch", () => {
  it("runs it for the organisation of the address and opens the run", async () => {
    rpcMock.mockReturnValue({ single: async () => ({ data: { run_id: RUN }, error: null }) });
    const valid = { ...input, start: "2099-01-01" };
    vi.useFakeTimers({ now: new Date("2098-06-01T12:00:00Z") });
    try {
      await expect(runCharaMatch("acme", valid)).resolves.toEqual({ runHref: `/en/org/acme/match?run=${RUN}` });
    } finally {
      vi.useRealTimers();
    }
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme", "member", { mfa: false, hideFromOutsiders: true });
    expect(rpcMock).toHaveBeenCalledWith("chara_match", {
      p_org: "org-1",
      p_destination: "DE",
      p_industry: "F",
      p_occupation: "7212",
      p_workers: 20,
      p_start: "2099-01-01",
      p_recruitment: "international",
    });
  });

  it("sends nothing for a bad slug, invalid values or while a release is off", async () => {
    await expect(runCharaMatch("Not a slug", input)).resolves.toEqual({ message: expect.any(String) });
    await expect(runCharaMatch("acme", { ...input, workers: "0" })).resolves.toMatchObject({ errors: { workers: expect.any(String) } });
    releasedMock.mockImplementation(async (name: string) => name !== "release_chara_match");
    await expect(runCharaMatch("acme", input)).resolves.toEqual({ message: "CHARA Match is not available for this organisation." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ message: "CHARA_FEATURE_NOT_IN_PLAN", details: "chara_match" }, { refused: "not_in_plan" }],
    [{ message: "CHARA_RATE_LIMITED" }, { refused: "rate_limited" }],
    [{ message: "CHARA_INVALID_INPUT", details: "p_start" }, { errors: { start: "Check this value and try again." } }],
    [{ message: "CHARA_FORBIDDEN", code: "42501", details: "organization_suspended" }, { message: "CHARA Match is not available for this organisation." }],
    [{ message: "boom", code: "XX000" }, { message: "Something went wrong (ref-1)" }],
  ])("answers the refusal %j", async (error, expected) => {
    rpcMock.mockReturnValue({ single: async () => ({ data: null, error }) });
    vi.useFakeTimers({ now: new Date("2098-06-01T12:00:00Z") });
    try {
      await expect(runCharaMatch("acme", { ...input, start: "2099-01-01" })).resolves.toEqual(expected);
    } finally {
      vi.useRealTimers();
    }
  });
});
