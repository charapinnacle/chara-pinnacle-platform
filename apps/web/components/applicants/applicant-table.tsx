import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { SelectApplicant } from "@/components/applicants/bulk-selection";
import { NewBadge } from "@/components/applicants/new-badge";
import { TextLink } from "@/components/forms/text-link";
import { applicationStatusLabels, FORMER_CANDIDATE } from "@/lib/applications/presentation";
import type { ApplicantRow } from "@/lib/dal/applicant-list";
import { formatShortDate } from "@/lib/i18n/format";
import { applicantPath, applicantsPath, jobPath } from "@/lib/routes";
import type { ApplicantListParams, ApplicantSort } from "@/lib/validation/applicant-list";

type ApplicantTableProps = { lang: string; slug: string; rows: ApplicantRow[]; params: ApplicantListParams; selectable: boolean };

const sortable: { key: ApplicantSort; label: string; sortLabel: string; vacancyOnly?: true }[] = [
  { key: "stage", label: "Stage", sortLabel: "Sort by Stage" },
  { key: "applied", label: "Applied", sortLabel: "Sort by Applied date" },
  { key: "completeness", label: "Completeness (%)", sortLabel: "Sort by Completeness (%)", vacancyOnly: true },
  { key: "documents", label: "Documents", sortLabel: "Sort by Documents", vacancyOnly: true },
];

const cell = "max-sm:flex max-sm:gap-2 max-sm:before:font-medium max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)] sm:px-3 sm:py-3";
const headCell = "text-start font-medium sm:px-3 sm:py-2";

// Each header sorts by its column: the first click ascending, the next descending; the list of all vacancies sorts by
// stage and applied date only (parseApplicantListParams). On a narrow screen the rows become cards and the headers a row
// of sort links.
export function ApplicantTable({ lang, slug, rows, params, selectable }: ApplicantTableProps) {
  const showVacancy = params.job === null;

  return (
    <table className="w-full text-body max-sm:block">
      <caption className="sr-only">Applicants</caption>
      <thead className="max-sm:block">
        <tr className="max-sm:flex max-sm:flex-wrap max-sm:gap-x-4 sm:border-b">
          {selectable ? (
            <th scope="col" className={`${headCell} w-10 max-sm:sr-only`}>
              <span className="sr-only">Select</span>
            </th>
          ) : null}
          <th scope="col" className={`${headCell} max-sm:sr-only`}>
            Candidate
          </th>
          {showVacancy ? (
            <th scope="col" className={`${headCell} max-sm:sr-only`}>
              Vacancy
            </th>
          ) : null}
          {sortable.map(({ key, label, sortLabel, vacancyOnly }) => {
            if (vacancyOnly && showVacancy) {
              return (
                <th key={key} scope="col" className={`${headCell} max-sm:sr-only`}>
                  {label}
                </th>
              );
            }
            const active = params.sort === key;
            const next = active && params.dir === "asc" ? "desc" : "asc";
            return (
              <th
                key={key}
                scope="col"
                aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : undefined}
                className={headCell}
              >
                <Link
                  href={applicantsPath(lang, slug, { ...params, sort: key, dir: next, page: 1 })}
                  aria-label={sortLabel}
                  className="inline-flex min-h-11 items-center gap-1 rounded-sm underline-offset-4 hover:underline"
                >
                  {label}
                  {active ? params.dir === "asc" ? <ArrowUp aria-hidden className="size-4" /> : <ArrowDown aria-hidden className="size-4" /> : null}
                </Link>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody className="max-sm:mt-3 max-sm:grid max-sm:gap-3">
        {rows.map((row) => (
          <tr key={row.id} className="max-sm:grid max-sm:gap-1 max-sm:rounded-xl max-sm:border max-sm:bg-card max-sm:p-4 sm:border-b">
            {selectable ? (
              <td className={`${cell} max-sm:items-center`}>
                <SelectApplicant id={row.id} name={row.candidateName ?? FORMER_CANDIDATE} />
              </td>
            ) : null}
            <td className={`${cell} wrap-anywhere max-sm:flex-wrap max-sm:items-center`}>
              <TextLink href={applicantPath(lang, slug, row.id)}>{row.candidateName ?? FORMER_CANDIDATE}</TextLink>{" "}
              {row.status === "applied" ? <NewBadge /> : null}
            </td>
            {showVacancy ? (
              <td data-label="Vacancy" className={`${cell} wrap-anywhere`}>
                <TextLink href={jobPath(lang, slug, row.jobId)}>{row.jobTitle}</TextLink>
              </td>
            ) : null}
            <td data-label="Stage" className={cell}>
              {applicationStatusLabels[row.status]}
            </td>
            <td data-label="Applied" className={cell}>
              <time dateTime={row.appliedAt}>{formatShortDate(row.appliedAt)}</time>
            </td>
            <td data-label="Completeness" className={cell}>
              {row.completeness} %
            </td>
            <td data-label="Documents" className={cell}>
              {row.documents}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
