import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { ApplyButton } from "@/components/jobs/apply-button";
import { EmployerMark } from "@/components/jobs/employer-mark";
import { ResultLink } from "@/components/jobs/result-link";
import { SaveJob } from "@/components/jobs/save-job";
import { getApplicationStates, type ApplicationState } from "@/lib/dal/applications";
import { searchJobs, type JobSearchResult } from "@/lib/dal/hiring";
import { getCountries } from "@/lib/dal/reference";
import { getSavedJobIds } from "@/lib/dal/saved-jobs";
import { getCurrentUser } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { formatSalary } from "@/lib/jobs/presentation";
import { searchPath, usedFilters, type JobSearchFilters } from "@/lib/jobs/search-params";
import { viewerOf, type Viewer } from "@/lib/jobs/viewer";
import { applicationPath } from "@/lib/routes";

type ResultRowProps = {
  job: JobSearchResult;
  lang: string;
  countryName: string;
  dialogHref: string;
  viewer: Viewer;
  saved: boolean;
  application: ApplicationState | undefined;
  next: string;
};

// A row says what a person decides on: the title, the employer, the place, the pay and the date, with Apply and Save. The
// facts of the vacancy (employment type, accommodation, visa support) are filters of the search and in the vacancy's
// dialog. The title's link covers the row; the actions sit above it.
function ResultRow({ job, lang, countryName, dialogHref, viewer, saved, application, next }: ResultRowProps) {
  const salary = formatSalary(job);
  return (
    <li className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-2xl border bg-card p-4 transition-colors hover:border-input has-data-pending:border-input has-data-pending:opacity-70 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-5">
      <EmployerMark name={job.employerName} />
      <div className="grid min-w-0 gap-0.5">
        <h2 className="text-lead font-semibold tracking-tight break-words">
          <ResultLink
            href={`/${lang}/jobs/${job.id}`}
            dialogHref={dialogHref}
            className="rounded-sm after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
          >
            {job.title}
          </ResultLink>
        </h2>
        <p className="text-small break-words text-muted-foreground">
          {job.employerName} · {job.city}, {countryName}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-2 text-small">
          {salary ? <span className="font-medium tabular-nums">{salary}</span> : null}
          <span className="text-muted-foreground">
            Posted <time dateTime={job.createdAt}>{formatDate(job.createdAt)}</time>
          </span>
        </p>
      </div>
      {viewer === "company" ? null : (
        <div className="relative z-10 col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end [&_a[data-slot]]:h-10 [&_button]:h-10 [&_button]:px-4">
          {application ? (
            <TextLink standalone href={applicationPath(lang, application.id)} aria-label={`View application: ${job.title}`}>
              View application
            </TextLink>
          ) : (
            <ApplyButton jobId={job.id} title={job.title} lang={lang} viewer={viewer} next={next} variant="secondary" />
          )}
          <SaveJob jobId={job.id} title={job.title} viewer={viewer} saved={saved} next={next} />
        </div>
      )}
    </li>
  );
}

function applicationOf(state: ApplicationState | undefined): ApplicationState | undefined {
  return state && state.status !== "withdrawn" ? state : undefined;
}

function countText(count: number, hasMore: boolean): string {
  return `${count} ${count === 1 ? "vacancy" : "vacancies"} shown${hasMore ? ", more on the next page" : ""}`;
}

function withJob(path: string, id: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}job=${id}`;
}

// The results of one address: streamed behind a skeleton by the page, and an error here reaches the error boundary of
// the route, which offers a retry.
export async function JobResults({ lang, filters }: { lang: string; filters: JobSearchFilters }) {
  const [{ results, nextCursor }, countries, user] = await Promise.all([searchJobs(filters), getCountries(), getCurrentUser()]);
  const viewer = viewerOf(user);
  const ids = results.map((job) => job.id);
  const [saved, states] =
    viewer === "candidate"
      ? await Promise.all([getSavedJobIds(ids), getApplicationStates(ids)])
      : [new Set<string>(), new Map<string, ApplicationState>()];
  const countryNames = new Map(countries.map(({ code, name }) => [code, name]));
  const filtered = usedFilters(filters).length > 0;
  const here = searchPath(lang, filters);

  if (results.length === 0) {
    return (
      <div role="status">
        <EmptyState
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
    <div className="grid gap-3">
      <p role="status" aria-live="polite" className="px-1 text-small text-muted-foreground">
        {countText(results.length, nextCursor !== null)}
      </p>
      <ul aria-label="Vacancies" className="animate-stagger grid gap-3">
        {results.map((job) => (
          <ResultRow
            key={job.id}
            job={job}
            lang={lang}
            countryName={countryNames.get(job.countryCode) ?? job.countryCode}
            dialogHref={withJob(here, job.id)}
            viewer={viewer}
            saved={saved.has(job.id)}
            application={applicationOf(states.get(job.id))}
            next={here}
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6 px-1">
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
