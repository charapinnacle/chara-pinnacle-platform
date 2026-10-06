import { Building2 } from "lucide-react";
import { FormButton } from "@/components/forms/form-button";
import type { Employer, Job } from "@/lib/dal/hiring";
import { formatSalary } from "@/lib/jobs/presentation";
import { employmentTypeLabels, recruitmentPreferenceLabels } from "@/lib/validation/job";

type VacancyViewProps = {
  job: Job;
  employer?: Employer | null;
  showActions?: boolean;
};

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

// The public layout of a vacancy. The employer card and the Apply and Save actions come from the pages that own them:
// the preview shows both, switched off, and the public page shows neither until FR-C4.
export function VacancyView({ job, employer = null, showActions = false }: VacancyViewProps) {
  const details = [
    ["Occupation", job.occupation],
    ["Industry", job.industry],
    ["Location", `${job.city}, ${job.country}`],
    ["Employment type", employmentTypeLabels[job.employmentType]],
    ["Salary", formatSalary(job) ?? "Not stated"],
    ["Accommodation", yesNo(job.accommodation)],
    ["Visa support", yesNo(job.visaSupport)],
    ["Recruitment", recruitmentPreferenceLabels[job.recruitmentPreference]],
  ] as const;

  return (
    <article className="grid gap-8">
      <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem] sm:leading-9">
        {job.title}
      </h1>

      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {details.map(([term, value]) => (
          <div key={term} className="grid gap-0.5">
            <dt className="text-sm text-muted-foreground">{term}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="job-description-heading" className="grid gap-2">
        <h2 id="job-description-heading" className="text-lg font-semibold">
          Description
        </h2>
        <p className="leading-7 break-words whitespace-pre-line">{job.description}</p>
      </section>

      {employer ? (
        <section aria-labelledby="job-employer-heading" className="grid gap-2 rounded-xl border bg-card p-4">
          <h2 id="job-employer-heading" className="flex items-center gap-2 text-lg font-semibold">
            <Building2 aria-hidden className="size-5 text-muted-foreground" />
            {employer.displayName}
          </h2>
          <p className="text-body text-muted-foreground">Based in {employer.country}</p>
          {employer.website ? <p className="text-sm break-all">{employer.website}</p> : null}
        </section>
      ) : null}

      {showActions ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-3">
            <FormButton disabled className="w-auto">
              Apply
            </FormButton>
            <FormButton disabled variant="secondary" className="w-auto">
              Save
            </FormButton>
          </div>
          <p className="text-sm text-muted-foreground">Apply and Save work once the vacancy is published.</p>
        </div>
      ) : null}
    </article>
  );
}
