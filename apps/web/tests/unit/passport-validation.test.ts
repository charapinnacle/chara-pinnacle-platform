import { describe, expect, it } from "vitest";
import { fieldErrors } from "@/lib/validation/sign-up";
import {
  authorizationSchema,
  basicsSchema,
  createPassportSchema,
  experienceSchema,
  languageSchema,
  occupationSchema,
  SKILL_LIMIT_MESSAGE,
  validateSkill,
} from "@/lib/validation/passport";

const NUL = String.fromCharCode(0);
const parseFirstName = (firstName: string) =>
  createPassportSchema.safeParse({ firstName, lastName: "Okafor", country: "NG" });
const TODAY = "2026-10-03";

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
    experienceSchema(TODAY).safeParse({ yearsExperience, availability: "", availableFrom: "" });

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
    const first = validateSkill([], " Welding ");
    expect(first).toEqual({ status: "added", skill: "Welding" });
    expect(validateSkill(["Welding"], "welding")).toEqual({ status: "duplicate" });
  });

  it("accepts 50 characters and refuses 51, an empty tag and a control character", () => {
    expect(validateSkill([], "a".repeat(50))).toEqual({ status: "added", skill: "a".repeat(50) });
    expect(validateSkill([], "a".repeat(51)).status).toBe("refused");
    expect(validateSkill([], "").status).toBe("refused");
    expect(validateSkill([], "   ").status).toBe("refused");
    expect(validateSkill([], `Weld${NUL}ing`).status).toBe("refused");
    expect(validateSkill([], "Weld\u0007ing").status).toBe("refused");
  });

  it("refuses the 31st distinct tag with the limit message", () => {
    const thirty = Array.from({ length: 30 }, (_, index) => `Skill ${index}`);
    expect(validateSkill(thirty.slice(0, 29), "Skill 29")).toEqual({ status: "added", skill: "Skill 29" });
    expect(validateSkill(thirty, "Skill 30")).toEqual({ status: "refused", message: "You can add up to 30 skills" });
    expect(SKILL_LIMIT_MESSAGE).toBe("You can add up to 30 skills");
  });

  it("reports a duplicate before the limit, so a full list still ignores a repeat", () => {
    const thirty = Array.from({ length: 30 }, (_, index) => `Skill ${index}`);
    expect(validateSkill(thirty, "skill 3")).toEqual({ status: "duplicate" });
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
  const schema = experienceSchema(TODAY);
  const parse = (availability: string, availableFrom = "") =>
    schema.safeParse({ yearsExperience: "6", availability, availableFrom });

  it("needs a date for from_date, from today to 24 months ahead", () => {
    expect(parse("from_date", "2026-10-03").data).toEqual({ yearsExperience: 6, availability: "from_date", availableFrom: "2026-10-03" });
    expect(parse("from_date", "2028-10-03").success).toBe(true);
    expect(parse("from_date", "2028-10-04").success).toBe(false);
    expect(parse("from_date", "2026-10-02").success).toBe(false);
    expect(parse("from_date", "").success).toBe(false);
    expect(parse("from_date", "2026-02-30").success).toBe(false);
    expect(parse("from_date", "03/10/2026").success).toBe(false);
  });

  it("clamps the window to the last day of the month like the database", () => {
    const leap = experienceSchema("2028-02-29");
    const parseLeap = (availableFrom: string) =>
      leap.safeParse({ yearsExperience: "", availability: "from_date", availableFrom }).success;
    expect(parseLeap("2030-02-28")).toBe(true);
    expect(parseLeap("2030-03-01")).toBe(false);
  });

  it("clears the date for now and unavailable, and an empty choice leaves availability unset", () => {
    expect(parse("now", "2027-01-01").data).toMatchObject({ availability: "now", availableFrom: null });
    expect(parse("unavailable", "2027-01-01").data).toMatchObject({ availability: "unavailable", availableFrom: null });
    expect(parse("").data).toMatchObject({ availability: null, availableFrom: null });
  });

  it("refuses an unknown availability and a bad years value in the same form", () => {
    expect(parse("soon").success).toBe(false);
    expect(schema.safeParse({ yearsExperience: "61", availability: "now", availableFrom: "" }).success).toBe(false);
  });
});

describe("work authorisation (FR-B1 AC9)", () => {
  const schema = authorizationSchema(TODAY);
  const parse = (expiresOn: string, country = "de") => schema.safeParse({ country, expiresOn });

  it("takes no expiry date, today, a later date and up to 50 years ahead", () => {
    expect(parse("").data).toEqual({ country: "DE", expiresOn: null });
    expect(parse("2026-10-03").data).toEqual({ country: "DE", expiresOn: "2026-10-03" });
    expect(parse("2076-10-03").success).toBe(true);
  });

  it("refuses yesterday, more than 50 years ahead and a date that does not exist", () => {
    expect(parse("2026-10-02").success).toBe(false);
    expect(parse("2076-10-04").success).toBe(false);
    expect(parse("2027-13-01").success).toBe(false);
  });

  it("needs a country", () => {
    expect(parse("", "").success).toBe(false);
  });
});
