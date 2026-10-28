import { describe, expect, it } from "vitest";
import { changedFieldsText, changeFields, requirementChangeFieldLabels } from "@/lib/requirements/change-fields";
import { changedByText, changeLines, changeValueText, toRequirementVersion } from "@/lib/requirements/versions";

const names = {
  countries: new Map([
    ["DE", "Germany"],
    ["AT", "Austria"],
  ]),
  industries: new Map([["C", "Manufacturing"]]),
};

describe("the changed fields of a requirement (FR-M2 step Edit)", () => {
  it("keep the order given, drop repeats and anything unknown", () => {
    expect(changeFields(["salary_max", "workers_needed", "salary_max", "<script>", 4, null])).toEqual(["salary_max", "workers_needed"]);
    expect(changeFields("workers_needed")).toEqual([]);
    expect(changeFields(undefined)).toEqual([]);
  });

  it("read as one list of the form's labels", () => {
    expect(changedFieldsText(["workers_needed"])).toBe("Number of workers");
    expect(changedFieldsText(["workers_needed", "occupations"])).toBe("Number of workers and Occupations");
    expect(changedFieldsText(["workers_needed", "occupations", "salary_max"])).toBe("Number of workers, Occupations and Salary maximum");
    expect(changedFieldsText([])).toBeUndefined();
    expect(changedFieldsText(["constructor", "__proto__"])).toBeUndefined();
  });

  it("name every field private.requirement_change_fields lists, in its order", () => {
    expect(Object.keys(requirementChangeFieldLabels)).toEqual([
      "title", "workers_needed", "occupations", "country_code", "countries", "city_region", "industry_code", "skills",
      "experience_years", "start_date", "duration_months", "employment_type", "salary_min", "salary_max", "salary_currency",
      "salary_period", "accommodation", "work_permit_support", "visa_support", "recruitment_preference", "partner_need", "closes_on",
    ]);
  });
});

describe("the values of a version in words", () => {
  it("write each kind of field as the requirement page does", () => {
    expect(changeValueText("workers_needed", 120, names)).toBe("120 workers");
    expect(changeValueText("workers_needed", 1, names)).toBe("1 worker");
    expect(changeValueText("salary_max", 3600, names)).toBe("3,600");
    expect(changeValueText("salary_min", "2500.50", names)).toBe("2,500.5");
    expect(changeValueText("start_date", "2027-03-01", names)).toBe("1 March 2027");
    expect(changeValueText("closes_on", "not a date", names)).toBe("Not stated");
    expect(changeValueText("country_code", "DE", names)).toBe("Germany");
    expect(changeValueText("countries", ["DE", "AT"], names)).toBe("Germany, Austria");
    expect(changeValueText("countries", [], names)).toBe("None");
    expect(changeValueText("countries", null, names)).toBe("None");
    expect(changeValueText("industry_code", "C", names)).toBe("Manufacturing");
    expect(changeValueText("industry_code", "Z", names)).toBe("Z");
    expect(changeValueText("experience_years", 2, names)).toBe("2 years");
    expect(changeValueText("duration_months", 12, names)).toBe("12 months");
    expect(changeValueText("employment_type", "full_time", names)).toBe("Full time");
    expect(changeValueText("employment_type", "constructor", names)).toBe("Not stated");
    expect(changeValueText("accommodation", true, names)).toBe("Yes");
    expect(changeValueText("visa_support", false, names)).toBe("No");
    expect(changeValueText("title", "Hamburg welders", names)).toBe("Hamburg welders");
    expect(changeValueText("skills", null, names)).toBe("Not stated");
    expect(changeValueText("salary_currency", "", names)).toBe("Not stated");
  });

  it("list the occupations with their codes, names and workers", () => {
    expect(
      changeValueText(
        "occupations",
        [
          { code: "7212", name: "Welders and flame cutters", quantity: 80 },
          { code: "7126", name: "Plumbers", quantity: 1 },
        ],
        names,
      ),
    ).toBe("7212 · Welders and flame cutters: 80 workers; 7126 · Plumbers: 1 worker");
    expect(changeValueText("occupations", [], names)).toBe("Not stated");
    expect(changeValueText("occupations", [null, "x"], names)).toBe("Not stated");
  });

  it("pair each changed field with its value before and after", () => {
    const version = toRequirementVersion({
      version: 1,
      created_at: "2026-11-02T10:00:00Z",
      changed_fields: ["workers_needed", "salary_max", "unknown_field"],
      old_values: { workers_needed: 100, salary_max: 3400 },
      new_values: { workers_needed: 120, salary_max: 3600 },
    });
    expect(version.changedBy).toBeUndefined();
    expect(changeLines(version, names)).toEqual([
      { field: "workers_needed", label: "Number of workers", before: "100 workers", after: "120 workers" },
      { field: "salary_max", label: "Salary maximum", before: "3,400", after: "3,600" },
    ]);
  });

  it("say who saved a version to the employer only", () => {
    const row = { version: 2, created_at: "2026-11-02T10:00:00Z", changed_fields: ["title"], old_values: null, new_values: [] };
    const employer = toRequirementVersion({ ...row, changed_by_member: true, changed_by_name: "Ada Admin" });
    expect(employer.oldValues).toEqual({});
    expect(employer.newValues).toEqual({});
    expect(changedByText(employer.changedBy)).toBe("Ada Admin");
    expect(changedByText(toRequirementVersion({ ...row, changed_by_member: true, changed_by_name: null }).changedBy)).toBe(
      "A member of your company",
    );
    expect(changedByText(toRequirementVersion({ ...row, changed_by_member: false }).changedBy)).toBe("A former member");
    expect(changedByText(toRequirementVersion(row).changedBy)).toBeNull();
  });
});
