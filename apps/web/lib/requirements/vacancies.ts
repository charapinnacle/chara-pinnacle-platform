import type { Database } from "@chara-pinnacle/db-types";
import { formatCount } from "@/lib/i18n/format";

type RequirementStatus = Database["public"]["Enums"]["requirement_status"];

// Only an open requirement is copied into vacancies (create_vacancies_from_requirement): a draft is published first, and
// a paused, closed or filled one is not recruiting.
export function canCreateVacancies(status: RequirementStatus): boolean {
  return status === "open";
}

export function draftVacanciesText(count: number): string {
  return `${formatCount(count)} draft ${count === 1 ? "vacancy" : "vacancies"}`;
}

// The question asked before a further copy (FR-M1 AC10: the page asks first when linked vacancies exist).
export function moreVacanciesText(linked: number, occupations: number): string {
  return `This requirement already has ${formatCount(linked)} linked ${linked === 1 ? "vacancy" : "vacancies"}. ${draftVacanciesText(occupations)} will be added, one per occupation.`;
}
