import { searchPath, type JobSearchFilters } from "@/lib/jobs/search-params";
import { employmentTypeLabels, recruitmentPreferenceLabels, salaryPeriodLabels } from "@/lib/validation/job";

export type FilterChip = { name: string; label: string; href: string };

type Names = {
  countries: ReadonlyMap<string, string>;
  occupations: ReadonlyMap<string, string>;
  industries: ReadonlyMap<string, string>;
};

// One chip per filter that is set, each with the address of the same search without it: the minimum salary, its currency
// and its pay period go together, and the page cursor never stays.
export function filterChips(lang: string, filters: JobSearchFilters, names: Names): FilterChip[] {
  const chips: FilterChip[] = [];
  const add = (name: keyof JobSearchFilters, label: string, ...removed: (keyof JobSearchFilters)[]) => {
    const dropped = Object.fromEntries([name, ...removed].map((key) => [key, undefined]));
    chips.push({ name, label, href: searchPath(lang, { ...filters, ...dropped, cursor: undefined }) });
  };

  if (filters.q) add("q", `Keyword: ${filters.q}`);
  if (filters.country) add("country", `Country: ${names.countries.get(filters.country) ?? filters.country}`);
  if (filters.city) add("city", `City: ${filters.city}`);
  if (filters.occupation) add("occupation", `Occupation: ${names.occupations.get(filters.occupation) ?? filters.occupation}`);
  if (filters.industry) add("industry", `Industry: ${names.industries.get(filters.industry) ?? filters.industry}`);
  if (filters.employment_type) add("employment_type", `Employment type: ${employmentTypeLabels[filters.employment_type]}`);
  if (filters.recruitment) add("recruitment", `Recruitment: ${recruitmentPreferenceLabels[filters.recruitment]}`);
  if (filters.salary_min !== undefined && filters.salary_currency && filters.salary_period) {
    const period = salaryPeriodLabels[filters.salary_period].toLowerCase();
    add("salary_min", `Minimum salary: ${filters.salary_min} ${filters.salary_currency} ${period}`, "salary_currency", "salary_period");
  }
  if (filters.accommodation) add("accommodation", "Accommodation provided");
  if (filters.visa_support) add("visa_support", "Visa support offered");
  return chips;
}
