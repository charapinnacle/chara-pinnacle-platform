import { PROHIBITED_CRITERION, type RequirementFormInput } from "@/lib/validation/requirement";

type RefusalError = { code?: string; message: string; details?: string | null };

type FieldPath = keyof RequirementFormInput | "occupations.root";

export type RequirementRefusal =
  | { kind: "field"; field: FieldPath; message: string }
  | { kind: "message"; message: string }
  | { kind: "fault" };

const CHECK_VALUE = "Check this value.";

export const REQUIREMENT_MESSAGES = {
  releaseOff: "Workforce requirements cannot be changed at the moment.",
  suspended: "This organization is suspended, so its workforce requirements cannot be changed.",
  notAllowed: "You are not allowed to create or edit workforce requirements for this company.",
  notFound: "This workforce requirement could not be found.",
  final: "This workforce requirement is closed or filled, so it can no longer be changed.",
  stale: "This requirement was changed by someone else, reload.",
  tooManyChanges: "Too many changes were made today. Try again tomorrow.",
} as const;

// save_requirement names the refused field in its detail; the checks and foreign keys of the tables are named by their
// constraint.
const invalidDetail: Record<string, [FieldPath, string]> = {
  start_date: ["startDate", "Choose a start date from today to 3 years ahead."],
  occupations: ["occupations.root", "Add 1 to 10 different occupations, each with a whole number of workers."],
  occupation_quantities: ["occupations.root", "Quantities must add up to the number of workers."],
  "prohibited_criterion:title": ["title", PROHIBITED_CRITERION],
  "prohibited_criterion:skills": ["skills", PROHIBITED_CRITERION],
  "prohibited_criterion:city_region": ["cityRegion", PROHIBITED_CRITERION],
};

const fieldByConstraint: Record<string, [FieldPath, string]> = {
  workforce_requirements_title_check: ["title", CHECK_VALUE],
  workforce_requirements_workers_needed_check: ["workersNeeded", CHECK_VALUE],
  workforce_requirements_city_region_check: ["cityRegion", CHECK_VALUE],
  workforce_requirements_skills_check: ["skills", CHECK_VALUE],
  workforce_requirements_experience_years_check: ["experienceYears", CHECK_VALUE],
  workforce_requirements_duration_months_check: ["durationMonths", CHECK_VALUE],
  workforce_requirements_salary_min_check: ["salaryMin", CHECK_VALUE],
  workforce_requirements_salary_max_check: ["salaryMax", CHECK_VALUE],
  workforce_requirements_salary_order: ["salaryMin", "The minimum salary cannot be higher than the maximum."],
  workforce_requirements_salary_terms: ["salaryCurrency", "Select a currency and a pay period when you enter a salary."],
  workforce_requirements_country_code_fkey: ["country", "Select a country from the list."],
  workforce_requirements_industry_code_fkey: ["industry", "Select an industry from the list."],
  workforce_requirements_salary_currency_fkey: ["salaryCurrency", "Select a currency from the list."],
  requirement_occupations_occupation_id_fkey: ["occupations.root", "Select each occupation from the list."],
  requirement_occupations_quantity_check: ["occupations.root", "Enter a whole number of workers for each occupation."],
};

// What the form shows for a refusal of save_requirement: a field error, a message for the form, or a fault the caller
// logs with a reference. No SQL text or detail of an unexpected error reaches the screen.
export function requirementRefusal(error: RefusalError): RequirementRefusal {
  if (error.message === "CHARA_INVALID_INPUT" && error.details && invalidDetail[error.details]) {
    const [field, message] = invalidDetail[error.details];
    return { kind: "field", field, message };
  }
  const constraint = /constraint "([^"]+)"/.exec(error.message)?.[1];
  const known = constraint ? fieldByConstraint[constraint] : undefined;
  if (known) return { kind: "field", field: known[0], message: known[1] };
  if (error.message === "CHARA_FORBIDDEN") {
    if (error.details === "release_off") return { kind: "message", message: REQUIREMENT_MESSAGES.releaseOff };
    if (error.details === "organization_suspended") return { kind: "message", message: REQUIREMENT_MESSAGES.suspended };
    return { kind: "message", message: REQUIREMENT_MESSAGES.notAllowed };
  }
  if (error.code === "42501") return { kind: "message", message: REQUIREMENT_MESSAGES.notAllowed };
  if (error.code === "P0002") return { kind: "message", message: REQUIREMENT_MESSAGES.notFound };
  if (error.message === "CHARA_INVALID_STATE") return { kind: "message", message: REQUIREMENT_MESSAGES.final };
  if (error.message === "CHARA_CONFLICT" && error.details === "stale") return { kind: "message", message: REQUIREMENT_MESSAGES.stale };
  if (error.message === "CHARA_RATE_LIMITED") return { kind: "message", message: REQUIREMENT_MESSAGES.tooManyChanges };
  return { kind: "fault" };
}

export const LIFECYCLE_MESSAGES = {
  notPossible: "This change is not possible in the current status of the requirement. Reload the page.",
  closesOnPassed: "The closing date has passed. Extend the requirement before you reopen it.",
  extensionLimit: "This requirement cannot be extended any further.",
  startDatePassed: "The start date has passed. Edit the requirement and choose a new start date before you publish it.",
  quantities: "The quantities no longer add up to the number of workers. Edit the requirement before you publish it.",
} as const;

// What the status actions show for a refusal of publish_requirement, set_requirement_status or extend_requirement: a
// message for the toast or the dialog, or a fault the caller logs. The refusals they share with save_requirement (who
// may act, a stale version, the quota) read as they do there.
export function lifecycleRefusal(error: RefusalError): { kind: "message"; message: string } | { kind: "fault" } {
  if (error.message === "CHARA_INVALID_TRANSITION") return { kind: "message", message: LIFECYCLE_MESSAGES.notPossible };
  if (error.message === "CHARA_INVALID_STATE") {
    if (error.details === "closes_on_passed") return { kind: "message", message: LIFECYCLE_MESSAGES.closesOnPassed };
    if (error.details === "extension_limit") return { kind: "message", message: LIFECYCLE_MESSAGES.extensionLimit };
    if (error.details === "draft") return { kind: "message", message: LIFECYCLE_MESSAGES.notPossible };
    return { kind: "message", message: REQUIREMENT_MESSAGES.final };
  }
  if (error.message === "CHARA_INVALID_INPUT") {
    if (error.details === "start_date") return { kind: "message", message: LIFECYCLE_MESSAGES.startDatePassed };
    if (error.details === "occupation_quantities") return { kind: "message", message: LIFECYCLE_MESSAGES.quantities };
    return { kind: "fault" };
  }
  const refusal = requirementRefusal(error);
  return refusal.kind === "message" ? refusal : { kind: "fault" };
}
