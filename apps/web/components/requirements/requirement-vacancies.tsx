import { StatusBadge } from "@/components/feedback/status-badge";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { CreateVacanciesButton } from "@/components/requirements/create-vacancies-button";
import type { RequirementVacancy } from "@/lib/dal/requirements";
import { formatDate } from "@/lib/i18n/format";
import { jobStatusText, jobStatusTone } from "@/lib/jobs/presentation";
import { jobPath } from "@/lib/routes";
import type { RequirementTarget } from "@/lib/validation/requirement-status";

type RequirementVacanciesProps = {
  lang: string;
  slug: string;
  target: RequirementTarget;
  // null when the list could not be read: the page stays up and offers no copy, since it cannot ask first.
  vacancies: RequirementVacancy[] | null;
  occupations: number;
  canCreate: boolean;
  // An anonymous job order (marketplace without the company name): a published vacancy shows the name (NFR-S11).
  anonymous: boolean;
};

// The vacancies for direct applications of a requirement (FR-M1 step Next steps, AC9, AC10; decision 3.1): candidates do
// not apply to a requirement, so an owner or admin copies an open one into draft vacancies, one per occupation, and
// publishes each. Members see the linked vacancies.
export function RequirementVacancies({ lang, slug, target, vacancies, occupations, canCreate, anonymous }: RequirementVacanciesProps) {
  if (!canCreate && vacancies !== null && vacancies.length === 0) return null;
  return (
    <section aria-labelledby="requirement-vacancies-heading" className="grid gap-3">
      <h2 id="requirement-vacancies-heading" className="text-h2">
        Vacancies for direct applications
      </h2>
      {vacancies === null ? (
        <Notice tone="warning" role="status">
          The linked vacancies could not be loaded. Reload the page to try again.
        </Notice>
      ) : (
        <>
          <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
            Candidates do not apply to a workforce requirement.{" "}
            {canCreate
              ? "Create one draft vacancy per occupation, check it and publish it to receive applications."
              : "These vacancies were created from it."}
          </p>
          {anonymous ? (
            <Notice tone="warning" role="status">
              Partners see this requirement as a job order without your company name. A published vacancy shows your company
              name, so edit each vacancy before you publish it and leave out anything partners could match to the job order.
            </Notice>
          ) : null}
          {vacancies.length > 0 ? (
            <ul className="grid gap-px overflow-hidden rounded-xl border bg-border" aria-label="Linked vacancies">
              {vacancies.map((vacancy) => (
                <li key={vacancy.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-card p-card">
                  <TextLink href={jobPath(lang, slug, vacancy.id)} className="break-words">
                    {vacancy.title}
                  </TextLink>
                  <StatusBadge status={jobStatusTone(vacancy.status, vacancy.moderationState)}>
                    {jobStatusText(vacancy.status, vacancy.moderationState)}
                  </StatusBadge>
                  <span className="text-small text-muted-foreground">Created {formatDate(vacancy.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small text-muted-foreground">No vacancies have been created from this requirement yet.</p>
          )}
          {canCreate ? <CreateVacanciesButton slug={slug} target={target} linked={vacancies.length} occupations={occupations} /> : null}
        </>
      )}
    </section>
  );
}
