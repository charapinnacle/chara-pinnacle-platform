import { Building2 } from "lucide-react";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import type { Employer, VacancyDetails } from "@/lib/dal/hiring";
import { formatDate } from "@/lib/i18n/format";
import { formatSalary, publicWebsite } from "@/lib/jobs/presentation";
import { employmentTypeLabels, recruitmentPreferenceLabels } from "@/lib/validation/job";

type VacancyViewProps = {
  job: VacancyDetails;
  employer?: Employer | null;
  publishedAt?: string;
  actions?: React.ReactNode;
};

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

// The public layout of a vacancy, shared by the public page and the employer's preview. The employer card, the date
// of publication and the actions come from the pages that own them: a draft has no date, and the actions differ.
export function VacancyView({ job, employer = null, publishedAt, actions }: VacancyViewProps) {
  const details: (readonly [string, React.ReactNode])[] = [
    ["Occupation", job.occupation],
    ["Industry", job.industry],
    ["Location", `${job.city}, ${job.country}`],
    ["Employment type", employmentTypeLabels[job.employmentType]],
    ["Salary", formatSalary(job) ?? "Not stated"],
    ["Accommodation", yesNo(job.accommodation)],
    ["Visa support", yesNo(job.visaSupport)],
    ["Recruitment", recruitmentPreferenceLabels[job.recruitmentPreference]],
    ...(publishedAt ? [["Published", <time key="published" dateTime={publishedAt}>{formatDate(publishedAt)}</time>] as const] : []),
  ];
  const website = publicWebsite(employer?.website ?? null);

  return (
    <article className="grid gap-8">
      <PageHeader title={job.title} />

      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {details.map(([term, value]) => (
          <div key={term} className="grid gap-0.5">
            <dt className="text-small text-muted-foreground">{term}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {actions}

      <section aria-labelledby="job-description-heading" className="grid gap-2">
        <h2 id="job-description-heading" className="text-h2">
          Description
        </h2>
        <p className="leading-7 break-words whitespace-pre-line">{job.description}</p>
      </section>

      {employer ? (
        <section aria-labelledby="job-employer-heading" className="grid gap-2 rounded-xl border bg-card p-4">
          <h2 id="job-employer-heading" className="flex items-center gap-2 text-h2">
            <Building2 aria-hidden className="size-5 text-muted-foreground" />
            {employer.displayName}
          </h2>
          <p className="text-body text-muted-foreground">Based in {employer.country}</p>
          {employer.industry ? <p className="text-body text-muted-foreground">Industry: {employer.industry}</p> : null}
          {website ? (
            <TextLink
              standalone
              href={website.href}
              target="_blank"
              rel="nofollow noopener noreferrer"
              prefetch={false}
              className="break-all"
            >
              {website.label}
              <span className="sr-only"> (opens in a new tab)</span>
            </TextLink>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}
