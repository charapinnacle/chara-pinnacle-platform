import { beforeEach, describe, expect, it, vi } from "vitest";
import { todayUtc } from "@/lib/validation/passport";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const revalidateMock = vi.hoisted(() => vi.fn());
const requireUserMock = vi.hoisted(() => vi.fn());
const skillNamesMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.fn();

type Call = { table: string; operation: string; values?: unknown; filters: Record<string, unknown> };
const calls: Call[] = [];
let outcome: { data: unknown; error: unknown } = { data: [], error: null };

function from(table: string) {
  const call: Call = { table, operation: "", filters: {} };
  const chain = {
    insert: (values: unknown) => Object.assign(call, { operation: "insert", values }) && chain,
    update: (values: unknown) => Object.assign(call, { operation: "update", values }) && chain,
    delete: () => Object.assign(call, { operation: "delete" }) && chain,
    eq: (column: string, value: unknown) => Object.assign(call.filters, { [column]: value }) && chain,
    select: () => chain,
    then: (resolve: (value: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve(outcome).then(resolve);
    },
  };
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/dal/passport", () => ({ getSkillNames: skillNamesMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock, from }) }));

const actions = await import("@/lib/actions/passport");

const userId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const skillId = "0a1b2c3d-0000-4000-8000-000000000001";
const GENERIC = "We could not complete this request. Try again.";

function failure(message: string, code = "P0001", details: string | null = null) {
  return { data: null, error: { message, code, details } };
}

function inDays(days: number): string {
  return new Date(Date.parse(`${todayUtc()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  outcome = { data: [{ user_id: userId }], error: null };
  requireUserMock.mockResolvedValue({ id: userId });
  skillNamesMock.mockResolvedValue([]);
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("createPassport", () => {
  const input = { firstName: "  Amina ", lastName: "Okafor", country: "ng" };

  it("checks the session, sends the normalised values with English and goes to the dashboard", async () => {
    await expect(actions.createPassport(input)).rejects.toThrow("REDIRECT:/en/dashboard/worker");
    expect(requireUserMock).toHaveBeenCalledWith("en");
    expect(rpcMock).toHaveBeenCalledWith("create_worker_passport", {
      p_first_name: "Amina",
      p_last_name: "Okafor",
      p_current_country: "NG",
      p_preferred_lang: "en",
    });
  });

  it("treats a second submit, which finds the passport already created, as done", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "duplicate key", code: "23505", details: null } });
    await expect(actions.createPassport(input)).rejects.toThrow("REDIRECT:/en/dashboard/worker");
  });

  it("returns a message and stays when the database refuses", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(actions.createPassport(input)).resolves.toEqual({ message: GENERIC });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns field messages and does not call the database for an invalid input", async () => {
    const result = await actions.createPassport({ firstName: "", lastName: "Okafor1", country: "" });
    expect(Object.keys(result?.errors ?? {}).sort()).toEqual(["country", "firstName", "lastName"]);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("profile sections", () => {
  it("saves the basics for the signed-in candidate only, with an empty headline as null", async () => {
    await expect(
      actions.saveBasics({ firstName: "Amina", lastName: "Okafor", country: "ng", headline: "  " }),
    ).resolves.toEqual({});
    expect(calls).toEqual([
      {
        table: "worker_profiles",
        operation: "update",
        values: { first_name: "Amina", last_name: "Okafor", headline: null, current_country: "NG" },
        filters: { user_id: userId },
      },
    ]);
    expect(revalidateMock).toHaveBeenCalledWith("/en/passport");
    expect(revalidateMock).toHaveBeenCalledWith("/en/dashboard/worker");
  });

  it("reports a failure when no profile row was updated", async () => {
    outcome = { data: [], error: null };
    await expect(
      actions.saveBasics({ firstName: "Amina", lastName: "Okafor", country: "NG", headline: "" }),
    ).resolves.toEqual({ message: GENERIC });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("saves an occupation code and clears it with an empty value, and refuses free text", async () => {
    await actions.saveOccupation({ occupation: "7411" });
    await actions.saveOccupation({ occupation: "" });
    expect(calls.map((call) => call.values)).toEqual([{ occupation_id: "7411" }, { occupation_id: null }]);
    const refused = await actions.saveOccupation({ occupation: "electrician" });
    expect(refused.errors).toHaveProperty("occupation");
    expect(calls).toHaveLength(2);
  });

  it("saves years and availability, and drops the date unless availability is from a date", async () => {
    await actions.saveExperience({ yearsExperience: "6", availability: "now", availableFrom: inDays(5) });
    await actions.saveExperience({ yearsExperience: "", availability: "from_date", availableFrom: inDays(30) });
    expect(calls.map((call) => call.values)).toEqual([
      { years_experience: 6, availability: "now", available_from: null },
      { years_experience: null, availability: "from_date", available_from: inDays(30) },
    ]);
  });

  it("refuses a start date in the past or without a date", async () => {
    const past = await actions.saveExperience({ yearsExperience: "", availability: "from_date", availableFrom: inDays(-1) });
    const none = await actions.saveExperience({ yearsExperience: "", availability: "from_date", availableFrom: "" });
    expect(past.errors).toHaveProperty("availableFrom");
    expect(none.errors).toHaveProperty("availableFrom");
    expect(calls).toHaveLength(0);
  });
});

describe("skills", () => {
  it("adds a trimmed skill for the signed-in candidate", async () => {
    await expect(actions.addSkill({ skill: " Welding " })).resolves.toEqual({});
    expect(calls).toEqual([
      { table: "worker_skills", operation: "insert", values: { worker_user_id: userId, skill: "Welding" }, filters: {} },
    ]);
  });

  it("ignores a skill that is already there in another letter case, without a write", async () => {
    skillNamesMock.mockResolvedValue(["Welding"]);
    await expect(actions.addSkill({ skill: "welding" })).resolves.toEqual({});
    expect(calls).toHaveLength(0);
  });

  it("refuses the 31st skill with the limit message and an invalid tag with its own", async () => {
    skillNamesMock.mockResolvedValue(Array.from({ length: 30 }, (_, index) => `Skill ${index}`));
    await expect(actions.addSkill({ skill: "One more" })).resolves.toEqual({
      errors: { skill: "You can add up to 30 skills" },
    });
    const long = await actions.addSkill({ skill: "x".repeat(51) });
    expect(long.errors?.skill).toBe("A skill can have up to 50 characters.");
    expect(calls).toHaveLength(0);
  });

  it("removes one skill of the signed-in candidate by id and refuses an id that is not one", async () => {
    await actions.removeSkill(skillId);
    expect(calls).toEqual([
      { table: "worker_skills", operation: "delete", filters: { worker_user_id: userId, id: skillId } },
    ]);
    await expect(actions.removeSkill("1 or 1=1")).resolves.toEqual({ message: GENERIC });
    expect(calls).toHaveLength(1);
  });
});

describe("languages, countries and work authorisations", () => {
  it("adds a language with its level", async () => {
    await actions.addLanguage({ language: "EN", level: "B2" });
    expect(calls[0]).toMatchObject({
      table: "worker_languages",
      operation: "insert",
      values: { worker_user_id: userId, language_code: "en", cefr_level: "B2" },
    });
    const refused = await actions.addLanguage({ language: "en", level: "native" });
    expect(refused.errors).toHaveProperty("level");
    expect(calls).toHaveLength(1);
  });

  it("adds and removes a preferred country", async () => {
    await actions.addPreferredCountry({ country: "de" });
    await actions.removePreferredCountry("DE");
    expect(calls).toEqual([
      { table: "worker_preferred_countries", operation: "insert", values: { worker_user_id: userId, country_code: "DE" }, filters: {} },
      { table: "worker_preferred_countries", operation: "delete", filters: { worker_user_id: userId, country_code: "DE" } },
    ]);
  });

  it("adds an authorisation with or without an expiry date and removes it", async () => {
    await actions.addAuthorization({ country: "de", expiresOn: inDays(365) });
    await actions.addAuthorization({ country: "ES", expiresOn: "" });
    await actions.removeAuthorization("ES");
    expect(calls.map((call) => call.values ?? call.filters)).toEqual([
      { worker_user_id: userId, country_code: "DE", expires_on: inDays(365) },
      { worker_user_id: userId, country_code: "ES", expires_on: null },
      { worker_user_id: userId, country_code: "ES" },
    ]);
  });

  it("refuses an expiry date in the past before the database is reached", async () => {
    const result = await actions.addAuthorization({ country: "DE", expiresOn: inDays(-1) });
    expect(result.errors).toHaveProperty("expiresOn");
    expect(calls).toHaveLength(0);
  });
});

describe("refusals of the database", () => {
  it.each([
    ["worker_skills", "You can add up to 30 skills"],
    ["worker_languages", "You can add up to 15 languages"],
    ["worker_preferred_countries", "You can add up to 20 preferred countries"],
  ])("names the limit of %s", async (table, message) => {
    outcome = failure("CHARA_LIMIT_REACHED", "P0001", table);
    await expect(actions.addPreferredCountry({ country: "DE" })).resolves.toEqual({ message });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("says that an item is already in the passport", async () => {
    outcome = failure("duplicate key value violates unique constraint", "23505");
    await expect(actions.addLanguage({ language: "en", level: "B2" })).resolves.toEqual({
      message: "This is already in your passport.",
    });
  });

  it.each([["23514"], ["23503"]])("asks to check the values after the database refused with %s", async (code) => {
    outcome = failure("violates constraint", code);
    await expect(actions.addPreferredCountry({ country: "XX" })).resolves.toEqual({
      message: "Check the values and try again.",
    });
  });

  it("does not show anything else to the person", async () => {
    outcome = failure("relation does not exist", "42P01");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(actions.addPreferredCountry({ country: "DE" })).resolves.toEqual({ message: GENERIC });
  });
});
