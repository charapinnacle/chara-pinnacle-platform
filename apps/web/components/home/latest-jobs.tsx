import { Banknote, MapPin } from "lucide-react";
import Link from "next/link";
import { TextLink } from "@/components/forms/text-link";
import { Band } from "@/components/home/band";
import { LinkButton, linkButtonClassName } from "@/components/layout/link-button";
import type { JobSearchResult } from "@/lib/dal/hiring";
import { formatShortDate } from "@/lib/i18n/format";
import { formatSalary } from "@/lib/jobs/presentation";
import { LATEST_JOBS_MINIMUM, LATEST_JOBS_SHOWN } from "@/lib/public/home";
import { signUpPath } from "@/lib/routes";

type JobCardProps = { job: JobSearchResult; lang: string; countryName: string };

// The whole card is one link to the vacancy page, named by the title: one stop for the keyboard, one large target. The
// employer has no logo in Phase 1, so its initial stands in a tile; "Apply now" is the look of the action the vacancy page
// offers, not a second control.
function JobCard({ job, lang, countryName }: JobCardProps) {
  const salary = formatSalary(job);
  const titleId = `home-job-${job.id}`;
  return (
    <li>
      <Link
        href={`/${lang}/jobs/${job.id}`}
        prefetch={false}
        aria-labelledby={titleId}
        className="lift group grid h-full content-between gap-6 rounded-card border bg-card p-6 transition-colors duration-150 hover:border-foreground/25"
      >
        <div className="grid gap-5">
          <div className="flex items-start gap-4">
            <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-inverse font-serif text-xl text-brand">
              {job.employerName.charAt(0).toUpperCase()}
            </span>
            <div className="grid min-w-0 gap-0.5">
              <h3 id={titleId} className="text-h3 break-words group-hover:underline group-hover:underline-offset-4">
                {job.title}
              </h3>
              <p className="truncate text-small text-muted-foreground">{job.employerName}</p>
            </div>
          </div>
          <ul className="grid gap-2 text-small">
            <li className="flex items-center gap-2">
              <MapPin aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="break-words">
                {job.city}, {countryName}
              </span>
            </li>
            {salary ? (
              <li className="flex items-center gap-2">
                <Banknote aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="tabular-nums">{salary}</span>
              </li>
            ) : null}
          </ul>
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <span className="text-caption text-muted-foreground">
            Posted <time dateTime={job.createdAt}>{formatShortDate(job.createdAt)}</time>
          </span>
          <span aria-hidden className={linkButtonClassName({ size: "default", className: "min-h-9" })}>
            Apply now
          </span>
        </div>
      </Link>
    </li>
  );
}

type LatestJobsProps = { lang: string; jobs: readonly JobSearchResult[]; countryNames: ReadonlyMap<string, string> };

// Real open vacancies from the public search, six from sm and three on a phone. With fewer than three the section would look
// broken, so it says what will be here and offers the way to post one instead.
export function LatestJobs({ lang, jobs, countryNames }: LatestJobsProps) {
  const enough = jobs.length >= LATEST_JOBS_MINIMUM;
  return (
    <Band aria-labelledby="home-jobs-heading" className="grid gap-10">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <h2 id="home-jobs-heading" className="font-serif text-section text-balance">
          Latest jobs
        </h2>
        <TextLink standalone href={`/${lang}/jobs`} prefetch={false}>
          Browse all jobs
        </TextLink>
      </div>
      {enough ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-sm:[&>li:nth-child(n+4)]:hidden">
          {jobs.slice(0, LATEST_JOBS_SHOWN).map((job) => (
            <JobCard key={job.id} job={job} lang={lang} countryName={countryNames.get(job.countryCode) ?? job.countryCode} />
          ))}
        </ul>
      ) : (
        <div className="grid justify-items-start gap-4 rounded-card border bg-card p-8 sm:p-12">
          <p className="text-h2">The first vacancies are on their way</p>
          <p className="max-w-[56ch] text-body text-muted-foreground">
            Open vacancies appear here as soon as employers publish them. Hiring? Publish yours and manage every applicant in one
            place.
          </p>
          <LinkButton href={signUpPath(lang, "company")} prefetch={false} className="mt-2">
            Post a Job
          </LinkButton>
        </div>
      )}
    </Band>
  );
}
