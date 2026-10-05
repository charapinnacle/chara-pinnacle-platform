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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

const { getPassport, getSkillNames, hasPassport } = await import("@/lib/dal/passport");

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
};

beforeEach(() => {
  requests.length = 0;
  outcome = { data: row, error: null };
});

describe("getPassport", () => {
  it("reads the profile and its four lists in one request for the given candidate, each list in a fixed order", async () => {
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
    });
  });

  it("returns null when the candidate has no passport and throws without the details when the read fails", async () => {
    outcome = { data: null, error: null };
    await expect(getPassport("no-passport")).resolves.toBeNull();
    outcome = { data: null, error: { message: "secret detail" } };
    await expect(getPassport("failing")).rejects.toThrow("The passport could not be loaded");
  });
});

describe("hasPassport and getSkillNames", () => {
  it("tells whether a profile row exists", async () => {
    outcome = { data: { user_id: userId }, error: null };
    await expect(hasPassport(userId)).resolves.toBe(true);
    outcome = { data: null, error: null };
    await expect(hasPassport(userId)).resolves.toBe(false);
  });

  it("lists the skill names of the candidate", async () => {
    outcome = { data: [{ skill: "Welding" }, { skill: "Plumbing" }], error: null };
    await expect(getSkillNames(userId)).resolves.toEqual(["Welding", "Plumbing"]);
    expect(requests.at(-1)?.filters).toEqual([["worker_user_id", userId]]);
  });
});
