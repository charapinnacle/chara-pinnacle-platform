import { beforeEach, describe, expect, it, vi } from "vitest";

type Request = { table: string; select?: string; filters: [string, unknown][]; orders: unknown[][] };
const requests: Request[] = [];
let outcome: { data: unknown; error: unknown } = { data: null, error: null };

function from(table: string) {
  const request: Request = { table, filters: [], orders: [] };
  const chain = {
    select: (columns: string) => Object.assign(request, { select: columns }) && chain,
    eq: (column: string, value: unknown) => request.filters.push([column, value]) && chain,
    gt: (column: string, value: unknown) => request.filters.push([column, value]) && chain,
    order: (...args: unknown[]) => request.orders.push(args) && chain,
    limit: () => chain,
    maybeSingle: () => {
      requests.push(request);
      return Promise.resolve(outcome);
    },
    then: (resolve: (value: unknown) => unknown) => {
      requests.push(request);
      return Promise.resolve(outcome).then(resolve);
    },
  };
  return chain;
}

vi.mock("server-only", () => ({}));
let rpcOutcome: { data: unknown; error: unknown } = { data: null, error: null };
let rpcName = "";
const rpc = (name: string) => {
  rpcName = name;
  return { single: () => Promise.resolve(rpcOutcome) };
};

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from, rpc }) }));

const { getPassport, getPassportLimits } = await import("@/lib/dal/passport");

const userId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const row = {
  first_name: "Amina",
  last_name: "Okafor",
  headline: null,
  current_country: "NG",
  occupation_id: "7411",
  years_experience: 0,
  availability: "from_date",
  available_from: "2026-11-01",
  worker_skills: [{ id: "s1", skill: "Welding" }],
  worker_languages: [{ language_code: "en", cefr_level: "B2" }],
  worker_preferred_countries: [{ country_code: "DE" }],
  worker_work_authorizations: [{ country_code: "DE", expires_on: null }],
  worker_training: [{ id: "t1", course: "Welding MIG/MAG level 2", provider: null, year_completed: 2021 }],
  worker_employment_history: [
    { id: "h1", role: "Welder", employer_name: null, country_code: "DE", from_month: "2022-12-01", to_month: null },
    { id: "h2", role: "Pipe welder", employer_name: "Acme", country_code: "DE", from_month: "2019-03-01", to_month: "2022-11-01" },
  ],
  worker_preferred_industries: [{ industry_code: "C" }],
  worker_preferred_employment_types: [{ employment_type: "full_time" }],
};

beforeEach(() => {
  requests.length = 0;
  outcome = { data: row, error: null };
});

describe("getPassport", () => {
  it("reads the profile and its eight lists in one request for the given candidate, each list in a fixed order", async () => {
    await getPassport(userId);
    expect(requests).toHaveLength(1);
    expect(requests[0].table).toBe("worker_profiles");
    expect(requests[0].filters).toEqual([["user_id", userId]]);
    expect(requests[0].select).toContain("worker_skills(id, skill)");
    expect(requests[0].orders.map(([column, options]) => `${column}@${(options as { referencedTable: string }).referencedTable}`)).toEqual([
      "skill@worker_skills",
      "language_code@worker_languages",
      "country_code@worker_preferred_countries",
      "country_code@worker_work_authorizations",
      "year_completed@worker_training",
      "from_month@worker_employment_history",
      "industry_code@worker_preferred_industries",
      "employment_type@worker_preferred_employment_types",
    ]);
  });

  it("returns the passport with a years value of 0 kept and the lists renamed", async () => {
    await expect(getPassport("another-user")).resolves.toEqual({
      firstName: "Amina",
      lastName: "Okafor",
      headline: null,
      country: "NG",
      occupationId: "7411",
      yearsExperience: 0,
      availability: "from_date",
      availableFrom: "2026-11-01",
      skills: [{ id: "s1", name: "Welding" }],
      languages: [{ code: "en", level: "B2" }],
      preferredCountries: ["DE"],
      authorizations: [{ country: "DE", expiresOn: null }],
      training: [{ id: "t1", course: "Welding MIG/MAG level 2", provider: null, yearCompleted: 2021 }],
      employmentHistory: [
        { id: "h1", role: "Welder", employerName: null, country: "DE", fromMonth: "2022-12", toMonth: null },
        { id: "h2", role: "Pipe welder", employerName: "Acme", country: "DE", fromMonth: "2019-03", toMonth: "2022-11" },
      ],
      preferredIndustries: ["C"],
      preferredEmploymentTypes: ["full_time"],
    });
  });

  it("returns null when the candidate has no passport and throws without the details when the read fails", async () => {
    outcome = { data: null, error: null };
    await expect(getPassport("no-passport")).resolves.toBeNull();
    outcome = { data: null, error: { message: "secret detail" } };
    await expect(getPassport("failing")).rejects.toThrow("The passport could not be loaded");
  });
});

describe("getPassportLimits", () => {
  it("maps the six settings the forms need and throws without the details when the read fails", async () => {
    rpcOutcome = {
      data: {
        skills_max: 40,
        availability_window_months: 12,
        work_authorization_expiry_max_years: 30,
        training_max: 20,
        employment_history_max: 25,
        preferred_industries_max: 10,
      },
      error: null,
    };
    await expect(getPassportLimits()).resolves.toEqual({
      skillsMax: 40,
      availabilityWindowMonths: 12,
      authorizationExpiryYears: 30,
      trainingMax: 20,
      employmentHistoryMax: 25,
      preferredIndustriesMax: 10,
    });
    expect(rpcName).toBe("passport_limits");
  });

  it("fails with a message that names no detail", async () => {
    rpcOutcome = { data: null, error: { message: "secret detail" } };
    await expect(getPassportLimits()).rejects.toThrow("The passport limits could not be loaded");
  });
});
