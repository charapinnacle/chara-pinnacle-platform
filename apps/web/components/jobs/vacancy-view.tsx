import { Building2, Clock, MapPin } from "lucide-react";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import type { Employer, VacancyDetails } from "@/lib/dal/hiring";
import { formatDate } from "@/lib/i18n/format";
import { formatSalary, publicWebsite } from "@/lib/jobs/presentation";
import { cn } from "@/lib/utils";
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
  const salary = formatSalary(job);
  const details: (readonly [string, React.ReactNode])[] = [
    ["Occupation", job.occupation],
    ["Industry", job.industry],
    ["Location", `${job.city}, ${job.country}`],
    ["Employment type", employmentTypeLabels[job.employmentType]],
    ["Salary", salary ?? "Not stated"],
    ["Accommodation", yesNo(job.accommodation)],
    ["Visa support", yesNo(job.visaSupport)],
    ["Recruitment", recruitmentPreferenceLabels[job.recruitmentPreference]],
    ...(publishedAt ? [["Published", <time key="published" dateTime={publishedAt}>{formatDate(publishedAt)}</time>] as const] : []),
  ];
  const website = publicWebsite(employer?.website ?? null);

  return (
    <article className={cn("grid gap-8", actions && "lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-12")}>
      <PageHeader title={job.title} className="animate-rise gap-3 lg:col-start-1">
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-body text-muted-foreground">
          {employer ? (
            <span className="inline-flex items-center gap-1.5">
              <Building2 aria-hidden className="size-4" />
              {employer.displayName}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <MapPin aria-hidden className="size-4" />
            {job.city}, {job.country}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock aria-hidden className="size-4" />
            {employmentTypeLabels[job.employmentType]}
          </span>
        </p>
      </PageHeader>

      {actions ? (
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Card elevated padding="lg" className="animate-rise gap-4 lg:sticky lg:top-8">
            <div className="grid gap-0.5">
              <p className="text-small text-muted-foreground">Salary</p>
              <p className={salary ? "text-h2 tabular-nums" : "text-body"}>{salary ?? "Not stated"}</p>
            </div>
            <div className="border-t pt-4">{actions}</div>
          </Card>
        </div>
      ) : null}

      <div className="grid content-start gap-10 lg:col-start-1">
        <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 sm:[&>:last-child:nth-child(odd)]:col-span-2">
          {details.map(([term, value]) => (
            <div key={term} className="grid content-start gap-0.5 bg-card p-card">
              <dt className="text-small text-muted-foreground">{term}</dt>
              <dd className="font-medium break-words">{value}</dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby="job-description-heading" className="grid gap-3">
          <h2 id="job-description-heading" className="text-h2">
            Description
          </h2>
          <p className="max-w-[65ch] leading-7 break-words whitespace-pre-line">{job.description}</p>
        </section>

        {employer ? (
          <Card as="section" aria-labelledby="job-employer-heading" padding="lg" className="gap-2">
            <h2 id="job-employer-heading" className="flex items-center gap-2 text-h2">
              <Building2 aria-hidden className="size-5 text-brand-ink" />
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
          </Card>
        ) : null}
      </div>
    </article>
  );
}
