import { Briefcase, Building2, Clock, MapPin } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { SaveJob } from "@/components/jobs/save-job";
import { Card } from "@/components/layout/card";
import { searchJobs, type JobSearchResult } from "@/lib/dal/hiring";
import { getCountries } from "@/lib/dal/reference";
import { getSavedJobIds } from "@/lib/dal/saved-jobs";
import { getCurrentUser } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { formatSalary } from "@/lib/jobs/presentation";
import { searchPath, usedFilters, type JobSearchFilters } from "@/lib/jobs/search-params";
import { viewerOf, type Viewer } from "@/lib/jobs/viewer";
import { employmentTypeLabels } from "@/lib/validation/job";

type ResultCardProps = { job: JobSearchResult; lang: string; countryName: string; viewer: Viewer; saved: boolean; next: string };

const tagClassName = "inline-flex min-h-7 items-center gap-1.5 rounded-full border bg-background px-2.5 text-small text-secondary-foreground";

function ResultCard({ job, lang, countryName, viewer, saved, next }: ResultCardProps) {
  const salary = formatSalary(job);
  return (
    <Card
      as="li"
      padding="lg"
      className="gap-4 transition-[transform,box-shadow,border-color] duration-200 ease-brand hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="text-h2">
            <TextLink href={`/${lang}/jobs/${job.id}`} className="break-words">
              {job.title}
            </TextLink>
          </h2>
          <p className="flex items-center gap-1.5 text-body break-words text-muted-foreground">
            <Building2 aria-hidden className="size-4 shrink-0" />
            {job.employerName}
          </p>
        </div>
        {viewer === "company" ? null : <SaveJob jobId={job.id} title={job.title} viewer={viewer} saved={saved} next={next} />}
      </div>
      <ul aria-label="Key facts" className="flex flex-wrap gap-2">
        <li className={tagClassName}>
          <MapPin aria-hidden className="size-3.5 text-muted-foreground" />
          {job.city}, {countryName}
        </li>
        <li className={tagClassName}>
          <Clock aria-hidden className="size-3.5 text-muted-foreground" />
          {employmentTypeLabels[job.employmentType]}
        </li>
        {job.accommodation ? (
          <li>
            <StatusBadge status="info">Accommodation</StatusBadge>
          </li>
        ) : null}
        {job.visaSupport ? (
          <li>
            <StatusBadge status="info">Visa support</StatusBadge>
          </li>
        ) : null}
      </ul>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t pt-4">
        <p className={salary ? "text-h3 tabular-nums" : "text-body text-muted-foreground"}>{salary ?? "Salary not stated"}</p>
        <p className="text-small text-muted-foreground">
          Posted <time dateTime={job.createdAt}>{formatDate(job.createdAt)}</time>
        </p>
      </div>
    </Card>
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
      <ul className="grid animate-stagger gap-3">
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
