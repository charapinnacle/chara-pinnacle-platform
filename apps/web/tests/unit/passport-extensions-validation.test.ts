import { describe, expect, it } from "vitest";
import { fieldErrors } from "@/lib/validation/sign-up";
import {
  employmentSchema,
  preferredEmploymentTypeSchema,
  preferredIndustrySchema,
  trainingSchema,
} from "@/lib/validation/passport-extensions";

const TODAY = "2026-10-03";
const employment = (patch: Record<string, unknown>) => ({
  role: "Pipe welder",
  employerName: "",
  country: "DE",
  fromMonth: "2019-03",
  toMonth: "2022-11",
  current: false,
  ...patch,
});
const training = (patch: Record<string, unknown>) => ({ course: "Welding MIG/MAG level 2", provider: "", yearCompleted: "2021", ...patch });
const employmentErrors = (patch: Record<string, unknown>) => {
  const result = employmentSchema(TODAY).safeParse(employment(patch));
  return result.success ? {} : fieldErrors(result.error);
};

describe("employment history form (FR-Q4 AC6)", () => {
  it("accepts 2019-03 and maps it to the first day of the month", () => {
    const result = employmentSchema(TODAY).parse(employment({}));
    expect(result.fromMonth).toBe("2019-03-01");
    expect(result.toMonth).toBe("2022-11-01");
  });

  it.each([["2019-3"], ["2019-03-15"], ["2019-13"]])("refuses %s with an error on the field", (fromMonth) => {
    expect(employmentErrors({ fromMonth })).toHaveProperty("fromMonth");
    expect(employmentErrors({ toMonth: fromMonth })).toHaveProperty("toMonth");
  });

  it("refuses a start month in the future and accepts the current one", () => {
    expect(employmentErrors({ fromMonth: "2026-11", toMonth: "" })).toEqual({ fromMonth: "The start month cannot be in the future." });
    expect(employmentErrors({ fromMonth: "2026-10", toMonth: "" })).toEqual({});
  });

  it("refuses an end before the start with an error on To", () => {
    expect(employmentErrors({ fromMonth: "2019-03", toMonth: "2019-02" })).toEqual({
      toMonth: "The end month cannot be before the start month.",
    });
  });

  it("reads an empty To, or I still work here, as current", () => {
    expect(employmentSchema(TODAY).parse(employment({ toMonth: "" })).toMonth).toBeNull();
    expect(employmentSchema(TODAY).parse(employment({ toMonth: "2019-02", current: true })).toMonth).toBeNull();
  });

  it("takes a role of 2 to 120 characters and an optional employer name of up to 120, empty as null", () => {
    expect(employmentErrors({ role: "" })).toHaveProperty("role");
    expect(employmentErrors({ role: "x" })).toHaveProperty("role");
    expect(employmentErrors({ employerName: "e".repeat(121) })).toHaveProperty("employerName");
    expect(employmentSchema(TODAY).parse(employment({ employerName: "  " })).employerName).toBeNull();
  });

  it("never puts a worker id in the payload", () => {
    const parsed = employmentSchema(TODAY).parse({ ...employment({}), worker_user_id: "someone-else" });
    expect(parsed).not.toHaveProperty("worker_user_id");
    expect(Object.keys(parsed).sort()).toEqual(["country", "employerName", "fromMonth", "role", "toMonth"]);
  });
});

describe("training form (FR-Q4 AC6)", () => {
  const errors = (patch: Record<string, unknown>) => {
    const result = trainingSchema(TODAY).safeParse(training(patch));
    return result.success ? {} : fieldErrors(result.error);
  };

  it("accepts the years 1960 to the current year and refuses 1959 and next year", () => {
    expect(errors({ yearCompleted: "2021" })).toEqual({});
    expect(errors({ yearCompleted: "1960" })).toEqual({});
    expect(errors({ yearCompleted: "2026" })).toEqual({});
    expect(errors({ yearCompleted: "1959" })).toHaveProperty("yearCompleted");
    expect(errors({ yearCompleted: "2027" })).toHaveProperty("yearCompleted");
  });

  it("refuses a course of 121 characters and of 1, and keeps an empty provider as null", () => {
    expect(errors({ course: "c".repeat(121) })).toHaveProperty("course");
    expect(errors({ course: "c" })).toHaveProperty("course");
    expect(errors({ course: "c".repeat(120) })).toEqual({});
    expect(trainingSchema(TODAY).parse(training({}))).toEqual({ course: "Welding MIG/MAG level 2", provider: null, yearCompleted: 2021 });
  });

  it("never puts a worker id in the payload", () => {
    expect(trainingSchema(TODAY).parse({ ...training({}), worker_user_id: "someone-else" })).not.toHaveProperty("worker_user_id");
  });
});

describe("preferences (NFR-M3)", () => {
  it("takes an industry as one ISIC section letter and an employment type from the vacancy list", () => {
    expect(preferredIndustrySchema.parse({ industry: " c " })).toEqual({ industry: "C" });
    expect(preferredIndustrySchema.safeParse({ industry: "Z9" }).success).toBe(false);
    expect(preferredEmploymentTypeSchema.safeParse({ employmentType: "seasonal" }).success).toBe(true);
    expect(preferredEmploymentTypeSchema.safeParse({ employmentType: "hourly" }).success).toBe(false);
  });
});
