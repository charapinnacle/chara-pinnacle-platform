import { describe, expect, it } from "vitest";
import { fieldErrors } from "@/lib/validation/sign-up";
import {
  authorizationFormSchema,
  authorizationSchema,
  basicsSchema,
  createPassportSchema,
  experienceFormSchema,
  experienceSchema,
  languageSchema,
  occupationSchema,
  skillLimitMessage,
  validateSkill,
} from "@/lib/validation/passport";

const NUL = String.fromCharCode(0);
const parseFirstName = (firstName: string) =>
  createPassportSchema.safeParse({ firstName, lastName: "Okafor", country: "NG" });
const TODAY = "2026-10-03";
const SKILLS_MAX = 30;

describe("names (FR-B1 AC4)", () => {
  it.each([
    ["Amina", "Amina"],
    ["O'Brien-Smith", "O'Brien-Smith"],
    ["Zoë", "Zoë"],
    ["  Amina  ", "Amina"],
    ["a".repeat(80), "a".repeat(80)],
    ["José María", "José María"],
    ["李明", "李明"],
    ["أحمد", "أحمد"],
    ["St. John", "St. John"],
  ])("accepts %j", (input, expected) => {
    expect(parseFirstName(input).data?.firstName).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "Amina1",
    "<b>x</b>",
    "Amina\nOkafor",
    "a".repeat(81),
    "-Amina",
    "Amina_Okafor",
    "😀",
  ])("refuses %j", (input) => {
    expect(parseFirstName(input).success).toBe(false);
  });

  // The same samples run in supabase/tests/database/026_worker_passport_rules.test.sql against private.is_person_name.
  it.each([
    ["ª", true],
    ["ℓ", true],
    ["Åsa", true],
    [`A${String.fromCodePoint(0xfe0f)}`, true],
    [`A${String.fromCodePoint(0x20dd)}`, true],
    [`A${String.fromCodePoint(0x302a)}`, true],
    [`Amina${String.fromCodePoint(0x661)}`, false],
    [`${String.fromCodePoint(0x966)}Amina`, false],
    [`Amina${String.fromCodePoint(0xe51)}`, false],
    [`Amina${String.fromCodePoint(0x1d7ce)}`, false],
    [`Am${String.fromCodePoint(0xfeff)}ina`, false],
    [`Amina${String.fromCodePoint(0x200b)}`, false],
    [`Amina${String.fromCodePoint(0x60c)}`, false],
    [`Amina${String.fromCodePoint(0xe3f)}`, false],
  ])("treats %j as a name character the way the database does: %s", (input, accepted) => {
    expect(parseFirstName(input).success).toBe(accepted);
  });

  it("shows one message per field, naming the field", () => {
    const result = createPassportSchema.safeParse({ firstName: "", lastName: "Okafor1", country: "NG" });
    expect(result.error && fieldErrors(result.error)).toEqual({
      firstName: "Enter your first name.",
      lastName: "Last name can only contain letters, spaces, hyphens, apostrophes and full stops.",
    });
  });

  it("normalises the country code", () => {
    expect(createPassportSchema.parse({ firstName: "Amina", lastName: "Okafor", country: " ng " }).country).toBe("NG");
    expect(createPassportSchema.safeParse({ firstName: "Amina", lastName: "Okafor", country: "" }).success).toBe(false);
  });
});

describe("headline (FR-B1 AC4)", () => {
  const parse = (headline: string) => basicsSchema.safeParse({ firstName: "Amina", lastName: "Okafor", country: "NG", headline });

  it.each([
    ["Welder", "Welder"],
    ["h".repeat(120), "h".repeat(120)],
    ["", null],
    ["   ", null],
    ["  Welder  ", "Welder"],
  ])("turns %j into %j", (input, expected) => {
    expect(parse(input).data?.headline).toBe(expected);
  });

  it.each(["h".repeat(121), "Welder\nPipe fitter", "Welder\rPipe fitter", `Weld${NUL}er`])("refuses %j", (input) => {
    expect(parse(input).success).toBe(false);
  });
});

describe("years of experience (FR-B1 AC4)", () => {
  const parse = (yearsExperience: string) =>
    experienceSchema().safeParse({ yearsExperience, availability: "", availableFrom: "" });

  it.each([
    ["0", 0],
    ["60", 60],
    ["12", 12],
    [" 7 ", 7],
    ["", null],
    ["  ", null],
  ])("turns %j into %j", (input, expected) => {
    expect(parse(input).data?.yearsExperience).toBe(expected);
  });

  it.each(["-1", "61", "2.5", "ten", "1e1", "0x10", "NaN"])("refuses %j", (input) => {
    expect(parse(input).success).toBe(false);
  });
});

describe("occupation", () => {
  it("accepts a four-digit ISCO code, and nothing becomes null", () => {
    expect(occupationSchema.parse({ occupation: "7411" })).toEqual({ occupation: "7411" });
    expect(occupationSchema.parse({ occupation: "" })).toEqual({ occupation: null });
  });

  it.each(["electrician", "741", "74111", "7411 Building"])("refuses free text such as %j", (input) => {
    expect(occupationSchema.safeParse({ occupation: input }).success).toBe(false);
  });
});

describe("skill tags (FR-B1 AC6)", () => {
  it("stores a trimmed tag, ignores a case-insensitive duplicate and keeps one tag", () => {
    const first = validateSkill([], " Welding ", SKILLS_MAX);
    expect(first).toEqual({ status: "added", skill: "Welding" });
    expect(validateSkill(["Welding"], "welding", SKILLS_MAX)).toEqual({ status: "duplicate" });
  });

  it("accepts 50 characters and refuses 51, an empty tag and a control character", () => {
    expect(validateSkill([], "a".repeat(50), SKILLS_MAX)).toEqual({ status: "added", skill: "a".repeat(50) });
    expect(validateSkill([], "a".repeat(51), SKILLS_MAX).status).toBe("refused");
    expect(validateSkill([], "", SKILLS_MAX).status).toBe("refused");
    expect(validateSkill([], "   ", SKILLS_MAX).status).toBe("refused");
    expect(validateSkill([], `Weld${NUL}ing`, SKILLS_MAX).status).toBe("refused");
    expect(validateSkill([], "Weld\u0007ing", SKILLS_MAX).status).toBe("refused");
  });

  it("refuses the 31st distinct tag with the limit message", () => {
    const thirty = Array.from({ length: 30 }, (_, index) => `Skill ${index}`);
    expect(validateSkill(thirty.slice(0, 29), "Skill 29", SKILLS_MAX)).toEqual({ status: "added", skill: "Skill 29" });
    expect(validateSkill(thirty, "Skill 30", SKILLS_MAX)).toEqual({
      status: "refused",
      message: "You can add up to 30 skills",
    });
  });

  it("takes the limit from the setting it is given, not from a constant", () => {
    expect(skillLimitMessage(45)).toBe("You can add up to 45 skills");
    const forty = Array.from({ length: 40 }, (_, index) => `Skill ${index}`);
    expect(validateSkill(forty, "Skill 40", 45)).toEqual({ status: "added", skill: "Skill 40" });
    expect(validateSkill(forty, "Skill 40", 40)).toEqual({ status: "refused", message: "You can add up to 40 skills" });
  });

  it("reports a duplicate before the limit, so a full list still ignores a repeat", () => {
    const thirty = Array.from({ length: 30 }, (_, index) => `Skill ${index}`);
    expect(validateSkill(thirty, "skill 3", SKILLS_MAX)).toEqual({ status: "duplicate" });
  });
});

describe("languages", () => {
  it("normalises the code and accepts the six CEFR levels only", () => {
    expect(languageSchema.parse({ language: " EN ", level: "B2" })).toEqual({ language: "en", level: "B2" });
    expect(languageSchema.safeParse({ language: "en", level: "B3" }).success).toBe(false);
    expect(languageSchema.safeParse({ language: "en", level: "native" }).success).toBe(false);
    expect(languageSchema.safeParse({ language: "eng", level: "B2" }).success).toBe(false);
    expect(languageSchema.safeParse({ language: "", level: "B2" }).success).toBe(false);
  });
});

describe("availability (FR-B1 states)", () => {
  const schema = experienceFormSchema({ today: TODAY, months: 24, saved: "" });
  const parse = (availability: string, availableFrom = "") =>
    schema.safeParse({ yearsExperience: "6", availability, availableFrom });

  it("needs a date for from_date, from today to 24 months ahead", () => {
    expect(parse("from_date", "2026-10-03").success).toBe(true);
    expect(parse("from_date", "2028-10-03").success).toBe(true);
    expect(parse("from_date", "2028-10-04").success).toBe(false);
    expect(parse("from_date", "2026-10-02").success).toBe(false);
    expect(parse("from_date", "").success).toBe(false);
    expect(parse("from_date", "2026-02-30").success).toBe(false);
    expect(parse("from_date", "03/10/2026").success).toBe(false);
  });

  it("quotes and applies the window it is given", () => {
    const year = experienceFormSchema({ today: TODAY, months: 12, saved: "" });
    const result = year.safeParse({ yearsExperience: "", availability: "from_date", availableFrom: "2027-10-04" });
    expect(result.error?.issues[0].message).toBe("Choose a date from today to 12 months ahead.");
    expect(year.safeParse({ yearsExperience: "", availability: "from_date", availableFrom: "2027-10-03" }).success).toBe(true);
  });

  it("clamps the window to the last day of the month like the database", () => {
    const leap = experienceFormSchema({ today: "2028-02-29", months: 24, saved: "" });
    const parseLeap = (availableFrom: string) =>
      leap.safeParse({ yearsExperience: "", availability: "from_date", availableFrom }).success;
    expect(parseLeap("2030-02-28")).toBe(true);
    expect(parseLeap("2030-03-01")).toBe(false);
  });

  it("lets a saved date that has since passed stay while another field changes, like the database", () => {
    const saved = experienceFormSchema({ today: TODAY, months: 24, saved: "2026-09-01" });
    const input = { yearsExperience: "7", availability: "from_date", availableFrom: "2026-09-01" };
    expect(saved.safeParse(input).success).toBe(true);
    expect(saved.safeParse({ ...input, availableFrom: "2026-09-02" }).success).toBe(false);
  });

  it("leaves the range to the database on the server but still needs a real date", () => {
    const server = experienceSchema();
    const parseServer = (availableFrom: string) =>
      server.safeParse({ yearsExperience: "", availability: "from_date", availableFrom });
    expect(parseServer("2020-01-01").success).toBe(true);
    expect(parseServer("").success).toBe(false);
    expect(parseServer("2026-02-30").success).toBe(false);
  });

  it("clears the date for now and unavailable, and an empty choice leaves availability unset", () => {
    const server = experienceSchema();
    const parseServer = (availability: string, availableFrom = "") =>
      server.safeParse({ yearsExperience: "6", availability, availableFrom });
    expect(parseServer("from_date", "2026-10-03").data).toEqual({ yearsExperience: 6, availability: "from_date", availableFrom: "2026-10-03" });
    expect(parseServer("now", "2027-01-01").data).toMatchObject({ availability: "now", availableFrom: null });
    expect(parseServer("unavailable", "2027-01-01").data).toMatchObject({ availability: "unavailable", availableFrom: null });
    expect(parseServer("").data).toMatchObject({ availability: null, availableFrom: null });
  });

  it("refuses an unknown availability and a bad years value in the same form", () => {
    expect(parse("soon").success).toBe(false);
    expect(schema.safeParse({ yearsExperience: "61", availability: "now", availableFrom: "" }).success).toBe(false);
  });
});

describe("work authorisation (FR-B1 AC9)", () => {
  const schema = authorizationFormSchema({ today: TODAY, years: 50 });
  const parse = (expiresOn: string, country = "de") => schema.safeParse({ country, expiresOn });

  it("takes no expiry date, today, a later date and up to 50 years ahead", () => {
    expect(authorizationSchema().parse({ country: "de", expiresOn: "" })).toEqual({ country: "DE", expiresOn: null });
    expect(authorizationSchema().parse({ country: "de", expiresOn: "2026-10-03" })).toEqual({ country: "DE", expiresOn: "2026-10-03" });
    expect(parse("").success).toBe(true);
    expect(parse("2026-10-03").success).toBe(true);
    expect(parse("2076-10-03").success).toBe(true);
  });

  it("refuses yesterday and more than the window ahead in the form, quoting the window, and a date that does not exist everywhere", () => {
    expect(parse("2026-10-02").error?.issues[0].message).toBe("Choose today or a later date, up to 50 years ahead.");
    expect(parse("2076-10-04").success).toBe(false);
    const short = authorizationFormSchema({ today: TODAY, years: 10 }).safeParse({ country: "de", expiresOn: "2036-10-04" });
    expect(short.error?.issues[0].message).toBe("Choose today or a later date, up to 10 years ahead.");
    expect(parse("2027-13-01").success).toBe(false);
    expect(authorizationSchema().safeParse({ country: "de", expiresOn: "2027-13-01" }).success).toBe(false);
  });

  it("leaves the range to the database on the server", () => {
    expect(authorizationSchema().safeParse({ country: "de", expiresOn: "2020-01-01" }).success).toBe(true);
  });

  it("needs a country", () => {
    expect(parse("", "").success).toBe(false);
  });
});
