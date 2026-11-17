import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchedOnText } from "@/lib/find-workers/presentation";
import {
  findWorkersFormDefaults,
  findWorkersQuery,
  parseFindWorkersParams,
  withoutAdvancedFilters,
  workerSearchFilters,
} from "@/lib/find-workers/search-params";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { getWorkerSearchAccess, searchWorkers } = await import("@/lib/dal/find-workers");

const ORG = "11111111-1111-4111-8111-111111111111";
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
const context = {
  destination: "DE",
  current_country: "NG",
  work_authorization: "PL",
  languages: { de: "German", en: "English" },
  countries: { DE: "Germany", NG: "Nigeria", PL: "Poland" },
};

beforeEach(() => {
  rpcMock.mockReset();
});

// FR-Q2 AC7: the card says why it matched, in a fixed order.
describe("matchedOnText (FR-Q2 AC7)", () => {
  it("names occupation, destination by its country name and the language with the card's level, in the fixed order", () => {
    expect(matchedOnText(["occupation", "destination", "language:de:B2"], context)).toBe(
      "Matched on: occupation, destination Germany, German (B2)",
    );
    expect(matchedOnText(["language:de:B2", "destination", "occupation"], context)).toBe(
      "Matched on: occupation, destination Germany, German (B2)",
    );
    expect(matchedOnText(["destination"], { ...context, countries: {} })).toBe("Matched on: destination DE");
  });

  it("has no line for a card found without a filter and ignores an unknown key", () => {
    expect(matchedOnText([], context)).toBeNull();
    expect(matchedOnText(["nationality"], context)).toBeNull();
    expect(matchedOnText(["nationality", "occupation", "language:de"], context)).toBe("Matched on: occupation");
  });

  it("names every filter", () => {
    expect(
      matchedOnText(
        ["work_authorization", "employment_type", "industry", "experience", "availability", "current_country", "skills", "headline"],
        context,
      ),
    ).toBe(
      "Matched on: headline, skills, current country Nigeria, availability, experience, industry, employment type, work authorisation Poland",
    );
  });
});

describe("the Find Workers address", () => {
  it("round-trips the filters, keeps the requirement and drops what does not parse", () => {
    const { filters, errors } = parseFindWorkersParams({
      requirement: "33333333-3333-4333-8333-333333333333",
      q: " welder ",
      occupation: "7212",
      destination: "de",
      skills: "Welding, TIG",
      language: "de",
      language_level: "B1",
      min_experience: "99",
      current_country: "Germany",
      limit: "500",
    });
    expect(errors).toEqual({ min_experience: "Enter a number of years from 0 to 60.", current_country: "Select a country from the list." });
    expect(filters).toMatchObject({ q: "welder", occupation: "7212", destination: "DE", skills: ["Welding", "TIG"], language_level: "B1", limit: 50 });
    expect(findWorkersQuery(filters)).toBe(
      "requirement=33333333-3333-4333-8333-333333333333&q=welder&occupation=7212&destination=DE&skills=Welding%2C+TIG&language=de&language_level=B1&limit=50",
    );
    expect(findWorkersFormDefaults(findWorkersQuery(filters))).toMatchObject({ skills: "Welding, TIG", language: "de", availability: "" });
  });

  it("reads available_by as availability by a date, and a malformed cursor as an error", () => {
    const { filters, errors } = parseFindWorkersParams({ available_by: "2027-03-01", cursor: "not hex" });
    expect(filters).toMatchObject({ available_by: "2027-03-01" });
    expect(filters.availability).toBeUndefined();
    expect(errors.cursor).toBe("The page link is not valid, so the first page is shown.");
  });

  it("builds the filters object of search_workers with known keys only", () => {
    const { filters } = parseFindWorkersParams({ q: "cook", availability: "now", language: "de", min_experience: "0", industry: "c" });
    expect(workerSearchFilters(filters)).toEqual({
      q: "cook",
      availability: "now",
      languages: [{ code: "de", min_level: "A1" }],
      min_experience: 0,
      industry: "C",
    });
    expect(workerSearchFilters(withoutAdvancedFilters(filters))).toEqual({ q: "cook", availability: "now" });
  });
});

describe("the Find Workers reads", () => {
  it("passes the filters and parses the cards, the rule and the next cursor", async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...card, direct_contact: "partner_required", notice: "Use a licensed partner.", matched_on: ["occupation"], next_cursor: "ab12" }],
      error: null,
    });
    const { filters } = parseFindWorkersParams({ occupation: "7212" });
    const search = await searchWorkers(ORG, filters);
    expect(rpcMock).toHaveBeenCalledWith("search_workers", { p_org: ORG, p_filters: { occupation: "7212" }, p_cursor: undefined, p_limit: 20 });
    expect(search).toMatchObject({ state: "found", nextCursor: "ab12", results: [{ directContact: "partner_required", matchedOn: ["occupation"] }] });
    if (search.state !== "found") throw new Error("expected results");
    expect(Object.keys(search.results[0].card)).not.toContain("direct_contact");
  });

  it("answers the refusals as states", async () => {
    const { filters } = parseFindWorkersParams({});
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FEATURE_NOT_IN_PLAN", details: "worker_search" } });
    expect(await searchWorkers(ORG, filters)).toEqual({ state: "refused", reason: "plan_required" });
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FEATURE_NOT_IN_PLAN", details: "advanced_worker_search" } });
    expect(await searchWorkers(ORG, filters)).toEqual({ state: "advanced_required" });
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_RATE_LIMITED", details: null } });
    expect(await searchWorkers(ORG, filters)).toEqual({ state: "rate_limited" });
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: "not_listed" } });
    expect(await searchWorkers(ORG, filters)).toEqual({ state: "refused", reason: "not_listed" });
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom", details: null } });
    await expect(searchWorkers(ORG, filters)).rejects.toThrow("The workers could not be loaded");
  });

  it("falls back to the first page when the cursor is no longer valid", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: "CHARA_INVALID_INPUT", details: "p_cursor" } })
      .mockResolvedValueOnce({ data: [], error: null });
    const { filters } = parseFindWorkersParams({ cursor: "ab12" });
    expect(await searchWorkers(ORG, filters)).toEqual({ state: "found", results: [], nextCursor: null, cursorIgnored: true });
  });

  it("reads the access of the organisation", async () => {
    rpcMock.mockReturnValue({ single: async () => ({ data: { advanced: true, default_destination: "DE" }, error: null }) });
    expect(await getWorkerSearchAccess(ORG)).toEqual({ state: "allowed", advanced: true, defaultDestination: "DE" });
    rpcMock.mockReturnValue({ single: async () => ({ data: null, error: { message: "CHARA_FEATURE_NOT_IN_PLAN", details: "worker_search" } }) });
    expect(await getWorkerSearchAccess(ORG)).toEqual({ state: "refused", reason: "plan_required" });
  });
});
