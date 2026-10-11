import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { ApplyButton } from "@/components/jobs/apply-button";
import { SaveJob } from "@/components/jobs/save-job";
import { searchJobs, type JobSearchResult } from "@/lib/dal/hiring";
import { getCountries } from "@/lib/dal/reference";
import { getSavedJobIds } from "@/lib/dal/saved-jobs";
import { getCurrentUser } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { formatSalary } from "@/lib/jobs/presentation";
import { searchPath, usedFilters, type JobSearchFilters } from "@/lib/jobs/search-params";
import { viewerOf, type Viewer } from "@/lib/jobs/viewer";

type ResultRowProps = { job: JobSearchResult; lang: string; countryName: string; viewer: Viewer; saved: boolean; next: string };

// A row says what a person decides on: the title, the employer, the place, the pay and the date. The facts of the vacancy
// page (employment type, accommodation, visa support) are filters of the search and stay there.
function ResultRow({ job, lang, countryName, viewer, saved, next }: ResultRowProps) {
  const salary = formatSalary(job);
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 py-6">
      <div className="grid min-w-0 flex-1 gap-1">
        <h2 className="text-h2">
          <TextLink href={`/${lang}/jobs/${job.id}`} className="break-words">
            {job.title}
          </TextLink>
        </h2>
        <p className="text-body break-words text-muted-foreground">
          {job.employerName} · {job.city}, {countryName}
        </p>
        <p className="text-body">
          {salary ? <span className="tabular-nums">{salary}</span> : null}
          {salary ? " · " : null}
          <span className="text-muted-foreground">
            Posted <time dateTime={job.createdAt}>{formatDate(job.createdAt)}</time>
          </span>
        </p>
      </div>
      {viewer === "company" ? null : (
        <div className="flex flex-wrap gap-3">
          <ApplyButton jobId={job.id} title={job.title} lang={lang} viewer={viewer} next={next} variant="secondary" />
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
      <ul className="animate-stagger divide-y border-y">
        {results.map((job) => (
          <ResultRow
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
