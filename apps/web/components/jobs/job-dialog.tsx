import { ArrowUpRight } from "lucide-react";
import { TextLink } from "@/components/forms/text-link";
import { EmployerMark } from "@/components/jobs/employer-mark";
import { VacancyActions } from "@/components/jobs/vacancy-actions";
import { VacancyDialog } from "@/components/jobs/vacancy-dialog";
import { getApplicationStates, type ApplicationState } from "@/lib/dal/applications";
import { getPublicJob } from "@/lib/dal/hiring";
import { getSavedJobIds } from "@/lib/dal/saved-jobs";
import { getCurrentUser } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { formatSalary } from "@/lib/jobs/presentation";
import { viewerOf } from "@/lib/jobs/viewer";
import { employmentTypeLabels, recruitmentPreferenceLabels } from "@/lib/validation/job";

// The vacancy opened from the results (job= in the address), in a dialog over the list: what the vacancy page says, with
// the same actions, and a link to the page itself (the report links and the employer's profile stay there). A vacancy
// that is not open and visible, or no longer, opens nothing.
export async function JobDialog({ id, lang, closeHref }: { id: string; lang: string; closeHref: string }) {
  const [job, user] = await Promise.all([getPublicJob(id), getCurrentUser()]);
  if (!job) return null;
  const viewer = viewerOf(user);
  const [saved, applications] =
    viewer === "candidate" ? await Promise.all([getSavedJobIds([job.id]), getApplicationStates([job.id])]) : [new Set<string>(), new Map<string, ApplicationState>()];
  const facts: [string, string][] = [
    ["Salary", formatSalary(job) ?? "Not stated"],
    ["Employment type", employmentTypeLabels[job.employmentType]],
    ["Recruitment", recruitmentPreferenceLabels[job.recruitmentPreference]],
    ["Industry", job.industry],
    ["Accommodation", job.accommodation ? "Provided" : "Not provided"],
    ["Visa support", job.visaSupport ? "Offered" : "Not offered"],
  ];

  return (
    <VacancyDialog labelledBy="vacancy-dialog-title" closeHref={closeHref}>
      <header className="grid gap-5 border-b p-6 pe-20 sm:p-8 sm:pe-20">
        <EmployerMark name={job.employer.displayName} size="lg" />
        <div className="grid gap-1">
          <h2 id="vacancy-dialog-title" className="text-title tracking-tight text-balance break-words">
            {job.title}
          </h2>
          <p className="text-body break-words text-muted-foreground">
            {job.employer.displayName} · {job.city}, {job.country}
          </p>
        </div>
        <VacancyActions job={job} lang={lang} viewer={viewer} saved={saved.has(job.id)} application={applications.get(job.id) ?? null} />
        <p className="text-small text-muted-foreground">
          Posted <time dateTime={job.publishedAt}>{formatDate(job.publishedAt)}</time> · {job.occupation}
        </p>
      </header>
      <dl className="grid grid-cols-2 border-b sm:grid-cols-3">
        {facts.map(([term, value]) => (
          <div key={term} className="-mb-px grid content-start gap-0.5 border-e border-b px-6 py-4 sm:px-8">
            <dt className="text-eyebrow text-muted-foreground uppercase">{term}</dt>
            <dd className="font-medium break-words tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="vacancy-dialog-about" className="grid gap-3 p-6 sm:p-8">
        <h3 id="vacancy-dialog-about" className="text-h3">
          About the job
        </h3>
        <p className="max-w-[65ch] leading-7 break-words whitespace-pre-line">{job.description}</p>
        <TextLink standalone href={`/${lang}/jobs/${job.id}`} className="mt-3 inline-flex items-center gap-1 justify-self-start">
          Open the vacancy page
          <ArrowUpRight aria-hidden className="size-4" />
        </TextLink>
      </section>
    </VacancyDialog>
  );
}
