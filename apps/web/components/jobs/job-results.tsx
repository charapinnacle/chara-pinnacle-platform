import { Suspense } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { TextLink } from "@/components/forms/text-link";
import { EmployerMark } from "@/components/jobs/employer-mark";
import { ResultLink } from "@/components/jobs/result-link";
import { VacancyPanel } from "@/components/jobs/vacancy-panel";
import { getApplicationStates, type ApplicationState } from "@/lib/dal/applications";
import { searchJobs, type JobSearchResult } from "@/lib/dal/hiring";
import { getCountries } from "@/lib/dal/reference";
import { getSavedJobIds } from "@/lib/dal/saved-jobs";
import { getCurrentUser } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { formatSalary } from "@/lib/jobs/presentation";
import { searchPath, usedFilters, type JobSearchFilters } from "@/lib/jobs/search-params";
import { viewerOf } from "@/lib/jobs/viewer";
import { cn } from "@/lib/utils";

type ResultRowProps = {
  job: JobSearchResult;
  lang: string;
  countryName: string;
  current: boolean;
  panelHref: string;
};

// A row says what a person decides on: the title, the employer, the place, the pay and the date. The facts of the vacancy
// (employment type, accommodation, visa support) are filters of the search and in the panel; applying and saving are
// there and on the vacancy page. The title's link covers the row.
function ResultRow({ job, lang, countryName, current, panelHref }: ResultRowProps) {
  const salary = formatSalary(job);
  return (
    <li
      className={cn(
        "relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 rounded-2xl border bg-card p-4 transition-colors hover:border-input has-data-pending:border-input",
        current && "lg:border-foreground lg:hover:border-foreground",
      )}
    >
      <EmployerMark name={job.employerName} />
      <div className="grid min-w-0 gap-0.5">
        <h2 className="text-lead font-semibold tracking-tight break-words">
          <ResultLink
            href={`/${lang}/jobs/${job.id}`}
            panelHref={panelHref}
            aria-current={current ? "true" : undefined}
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
    </li>
  );
}

function countText(count: number, hasMore: boolean): string {
  return `${count} ${count === 1 ? "vacancy" : "vacancies"} shown${hasMore ? ", more on the next page" : ""}`;
}

function withJob(path: string, id: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}job=${id}`;
}

// The results of one address: streamed behind a skeleton by the page, and an error here reaches the error boundary of
// the route, which offers a retry. From 1024 px the vacancy of the job parameter, or the first one, is open beside the
// list; job is not a filter and a new search starts again at the first result.
export async function JobResults({ lang, filters, selected }: { lang: string; filters: JobSearchFilters; selected?: string }) {
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

  const current = results.some((job) => job.id === selected) ? selected : results[0].id;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start [&:has([data-pending])_aside]:opacity-60 [&_aside]:transition-opacity">
      <div className="grid gap-3">
        <p role="status" aria-live="polite" className="px-1 text-small text-muted-foreground">
          {countText(results.length, nextCursor !== null)}
        </p>
        <ul aria-label="Vacancies" className="animate-stagger grid gap-2">
          {results.map((job) => (
            <ResultRow
              key={job.id}
              job={job}
              lang={lang}
              countryName={countryNames.get(job.countryCode) ?? job.countryCode}
              current={job.id === current}
              panelHref={withJob(here, job.id)}
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
      {current ? (
        <aside aria-label="Selected vacancy" className="hidden lg:sticky lg:top-40 lg:block">
          <Suspense key={current} fallback={<LoadingSkeleton rows={6} />}>
            <VacancyPanel
              id={current}
              lang={lang}
              viewer={viewer}
              saved={saved.has(current)}
              application={states.get(current) ?? null}
            />
          </Suspense>
        </aside>
      ) : null}
    </div>
  );
}
