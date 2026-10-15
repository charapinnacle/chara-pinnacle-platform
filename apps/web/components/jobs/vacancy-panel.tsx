import { ArrowUpRight } from "lucide-react";
import { TextLink } from "@/components/forms/text-link";
import { EmployerMark } from "@/components/jobs/employer-mark";
import { VacancyActions } from "@/components/jobs/vacancy-actions";
import type { ApplicationState } from "@/lib/dal/applications";
import { getPublicJob } from "@/lib/dal/hiring";
import { formatDate } from "@/lib/i18n/format";
import { formatSalary } from "@/lib/jobs/presentation";
import type { Viewer } from "@/lib/jobs/viewer";
import { employmentTypeLabels, recruitmentPreferenceLabels } from "@/lib/validation/job";

type VacancyPanelProps = {
  id: string;
  lang: string;
  viewer: Viewer;
  saved: boolean;
  application: ApplicationState | null;
};

// The vacancy chosen in the list, beside it from 1024 px: what the vacancy page says, with the same actions, and a link to
// the page itself (the report links and the employer's profile stay there). A vacancy closed since the list was read
// leaves the panel empty rather than failing the page.
export async function VacancyPanel({ id, lang, viewer, saved, application }: VacancyPanelProps) {
  const job = await getPublicJob(id);
  if (!job) return null;
  const facts: [string, string][] = [
    ["Salary", formatSalary(job) ?? "Not stated"],
    ["Employment type", employmentTypeLabels[job.employmentType]],
    ["Recruitment", recruitmentPreferenceLabels[job.recruitmentPreference]],
    ["Industry", job.industry],
    ["Accommodation", job.accommodation ? "Provided" : "Not provided"],
    ["Visa support", job.visaSupport ? "Offered" : "Not offered"],
  ];

  return (
    <article aria-labelledby="vacancy-panel-title" className="overflow-hidden rounded-3xl border bg-card shadow-card">
      <header className="grid gap-5 border-b p-8">
        <EmployerMark name={job.employer.displayName} size="lg" />
        <div className="grid gap-1">
          <h2 id="vacancy-panel-title" className="text-title tracking-tight text-balance break-words">
            {job.title}
          </h2>
          <p className="text-body break-words text-muted-foreground">
            {job.employer.displayName} · {job.city}, {job.country}
          </p>
        </div>
        <VacancyActions job={job} lang={lang} viewer={viewer} saved={saved} application={application} />
        <p className="text-small text-muted-foreground">
          Posted <time dateTime={job.publishedAt}>{formatDate(job.publishedAt)}</time> · {job.occupation}
        </p>
      </header>
      <dl className="grid grid-cols-2 border-b xl:grid-cols-3">
        {facts.map(([term, value]) => (
          <div key={term} className="-mb-px grid content-start gap-0.5 border-e border-b px-8 py-4">
            <dt className="text-eyebrow text-muted-foreground uppercase">{term}</dt>
            <dd className="font-medium break-words tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="vacancy-panel-about" className="grid gap-3 p-8">
        <h3 id="vacancy-panel-about" className="text-h3">
          About the job
        </h3>
        <p className="max-w-[65ch] leading-7 break-words whitespace-pre-line">{job.description}</p>
        <TextLink standalone href={`/${lang}/jobs/${job.id}`} className="mt-3 inline-flex items-center gap-1 justify-self-start">
          Open the vacancy page
          <ArrowUpRight aria-hidden className="size-4" />
        </TextLink>
      </section>
    </article>
  );
}
