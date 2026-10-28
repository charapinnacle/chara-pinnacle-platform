import { formatCount, formatDate } from "@/lib/i18n/format";
import { changeFields, requirementChangeFieldLabels, type RequirementChangeField } from "@/lib/requirements/change-fields";
import { monthsText, workersText, yearsText } from "@/lib/requirements/presentation";
import { employmentTypeLabels, recruitmentPreferenceLabels, salaryPeriodLabels } from "@/lib/validation/job";
import { partnerNeedLabels } from "@/lib/validation/requirement";

// One saved edit of a published requirement as the history shows it (FR-M2 step Edit): the version, when, the fields
// in the order of the form with their old and new values as stored, and who saved it (employer view only).
export type RequirementVersion = {
  version: number;
  createdAt: string;
  fields: RequirementChangeField[];
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changedBy?: { member: boolean; name: string | null };
};

export type ChangeNames = { countries: ReadonlyMap<string, string>; industries: ReadonlyMap<string, string> };

export type ChangeLine = { field: RequirementChangeField; label: string; before: string; after: string };

const NOT_STATED = "Not stated";
const amountFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function label<T extends string>(labels: Record<T, string>, value: unknown): string {
  return typeof value === "string" && Object.hasOwn(labels, value) ? labels[value as T] : NOT_STATED;
}

function asNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function asDate(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value)) ? formatDate(value) : NOT_STATED;
}

function occupationsText(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return NOT_STATED;
  return value
    .map((item: unknown) => {
      if (typeof item !== "object" || item === null) return null;
      const { code, name, quantity } = item as Record<string, unknown>;
      const count = asNumber(quantity);
      const title = [code, name].filter((part): part is string => typeof part === "string" && part !== "").join(" · ");
      return title ? `${title}: ${count === null ? NOT_STATED : workersText(count)}` : null;
    })
    .filter((line): line is string => line !== null)
    .join("; ");
}

// A stored value of one field in words, as the requirement page writes it; a missing or unknown value is "Not stated".
export function changeValueText(field: RequirementChangeField, value: unknown, names: ChangeNames): string {
  if (value === null || value === undefined) return field === "countries" ? "None" : NOT_STATED;
  switch (field) {
    case "workers_needed": {
      const count = asNumber(value);
      return count === null ? NOT_STATED : workersText(count);
    }
    case "occupations":
      return occupationsText(value);
    case "country_code":
      return typeof value === "string" ? (names.countries.get(value) ?? value) : NOT_STATED;
    case "countries":
      return Array.isArray(value) && value.length > 0
        ? value.map((code: unknown) => (typeof code === "string" ? (names.countries.get(code) ?? code) : NOT_STATED)).join(", ")
        : "None";
    case "industry_code":
      return typeof value === "string" ? (names.industries.get(value) ?? value) : NOT_STATED;
    case "experience_years": {
      const count = asNumber(value);
      return count === null ? NOT_STATED : yearsText(count);
    }
    case "duration_months": {
      const count = asNumber(value);
      return count === null ? NOT_STATED : monthsText(count);
    }
    case "start_date":
    case "closes_on":
      return asDate(value);
    case "employment_type":
      return label(employmentTypeLabels, value);
    case "salary_period":
      return label(salaryPeriodLabels, value);
    case "recruitment_preference":
      return label(recruitmentPreferenceLabels, value);
    case "partner_need":
      return label(partnerNeedLabels, value);
    case "salary_min":
    case "salary_max": {
      const amount = asNumber(value);
      return amount === null ? NOT_STATED : amountFormat.format(amount);
    }
    case "accommodation":
    case "work_permit_support":
    case "visa_support":
      return typeof value === "boolean" ? (value ? "Yes" : "No") : NOT_STATED;
    default:
      return typeof value === "string" && value.trim() !== "" ? value : typeof value === "number" ? formatCount(value) : NOT_STATED;
  }
}

// The lines of one version: each changed field with its old and new value in words.
export function changeLines(version: Pick<RequirementVersion, "fields" | "oldValues" | "newValues">, names: ChangeNames): ChangeLine[] {
  return version.fields.map((field) => ({
    field,
    label: requirementChangeFieldLabels[field],
    before: changeValueText(field, version.oldValues[field], names),
    after: changeValueText(field, version.newValues[field], names),
  }));
}

// Who saved a version, for the employer: the member's name, a member without one, or an erased account.
export function changedByText(changedBy: RequirementVersion["changedBy"]): string | null {
  if (!changedBy) return null;
  if (!changedBy.member) return "A former member";
  return changedBy.name ?? "A member of your company";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

type VersionRow = {
  version: number;
  created_at: string;
  changed_fields: string[];
  old_values: unknown;
  new_values: unknown;
  changed_by_member?: boolean;
  changed_by_name?: string | null;
};

// A row of list_requirement_versions or list_invitation_changes; a field the page does not know is left out.
export function toRequirementVersion(row: VersionRow): RequirementVersion {
  return {
    version: row.version,
    createdAt: row.created_at,
    fields: changeFields(row.changed_fields),
    oldValues: asRecord(row.old_values),
    newValues: asRecord(row.new_values),
    ...(row.changed_by_member === undefined
      ? {}
      : { changedBy: { member: row.changed_by_member, name: row.changed_by_name ?? null } }),
  };
}
