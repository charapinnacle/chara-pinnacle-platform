import { Briefcase } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { SaveJob } from "@/components/jobs/save-job";
import { searchJobs, type JobSearchResult } from "@/lib/dal/hiring";
import { getCountries } from "@/lib/dal/reference";
import { getSavedJobIds } from "@/lib/dal/saved-jobs";
import { getCurrentUser } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { formatSalary } from "@/lib/jobs/presentation";
import { searchPath, usedFilters, type JobSearchFilters } from "@/lib/jobs/search-params";
import { viewerOf, type Viewer } from "@/lib/jobs/viewer";
import { employmentTypeLabels } from "@/lib/validation/job";

const badgeClassName = "rounded-full border bg-accent px-2 py-0.5 text-sm font-medium text-accent-foreground";

type ResultCardProps = { job: JobSearchResult; lang: string; countryName: string; viewer: Viewer; saved: boolean; next: string };

function ResultCard({ job, lang, countryName, viewer, saved, next }: ResultCardProps) {
  return (
    <li className="grid gap-2 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">
        <TextLink href={`/${lang}/jobs/${job.id}`} className="break-words">
          {job.title}
        </TextLink>
      </h2>
      <p className="font-medium break-words">{job.employerName}</p>
      <p className="text-body text-muted-foreground">
        {job.city}, {countryName}
      </p>
      <p className="text-body">
        {employmentTypeLabels[job.employmentType]} · {formatSalary(job) ?? "Salary not stated"}
      </p>
      {job.accommodation || job.visaSupport ? (
        <p className="flex flex-wrap gap-2">
          {job.accommodation ? <span className={badgeClassName}>Accommodation</span> : null}
          {job.visaSupport ? <span className={badgeClassName}>Visa support</span> : null}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Posted <time dateTime={job.createdAt}>{formatDate(job.createdAt)}</time>
      </p>
      {viewer === "company" ? null : (
        <div className="flex">
          <SaveJob jobId={job.id} title={job.title} viewer={viewer} saved={saved} next={next} />
        </div>
      )}
    </li>
  );
}

function countText(count: number, hasMore: boolean): string {
  return `${count} ${count === 1 ? "vacancy" : "vacancies"} shown${hasMore ? ", more on the next page" : ""}`;
}

// The results of one address: streamed behind a skeleton by the page, and an error here reaches the error boundary of
// the route, which offers a retry.
export async function JobResults({ lang, filters }: { lang: string; filters: JobSearchFilters }) {
  const [{ results, nextCursor }, countries, user] = await Promise.all([searchJobs(filters), getCountries(), getCurrentUser()]);
  const viewer = viewerOf(user);
  const saved = viewer === "candidate" ? await getSavedJobIds(results.map((job) => job.id)) : new Set<string>();
  const countryNames = new Map(countries.map(({ code, name }) => [code, name]));
  const filtered = usedFilters(filters).length > 0;
  const here = searchPath(lang, filters);

  if (results.length === 0) {
    return (
      <div role="status">
        <EmptyState
          icon={Briefcase}
          title={filtered ? "No vacancies match your search" : "There are no open vacancies yet"}
          description={filtered ? "Try fewer filters or a different keyword." : "Check back soon."}
        >
          {filtered ? (
            <TextLink standalone href={`/${lang}/jobs`}>
              Clear filters
            </TextLink>
          ) : null}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p role="status" aria-live="polite" className="text-body text-muted-foreground">
        {countText(results.length, nextCursor !== null)}
      </p>
      <ul className="grid gap-3">
        {results.map((job) => (
          <ResultCard
            key={job.id}
            job={job}
            lang={lang}
            countryName={countryNames.get(job.countryCode) ?? job.countryCode}
            viewer={viewer}
            saved={saved.has(job.id)}
            next={here}
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6">
        {nextCursor ? (
          <TextLink standalone href={searchPath(lang, { ...filters, cursor: nextCursor })}>
            Show more vacancies
          </TextLink>
        ) : null}
        {filters.cursor ? (
          <TextLink standalone href={searchPath(lang, { ...filters, cursor: undefined })}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
