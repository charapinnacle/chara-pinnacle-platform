import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActiveFilters } from "@/components/jobs/active-filters";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { JobDialog } from "@/components/jobs/job-dialog";
import { JobResults } from "@/components/jobs/job-results";
import { JobSearchForm } from "@/components/jobs/job-search-form";
import { PageHeader } from "@/components/layout/page-header";
import { getCountries, getCurrencies, getIndustries, getOccupations } from "@/lib/dal/reference";
import { filterChips } from "@/lib/jobs/filter-chips";
import { parseSearchParams, resolvePlace, searchPath, searchQuery } from "@/lib/jobs/search-params";
import { staticPageMetadata } from "@/lib/seo/metadata";
import { jobIdSchema } from "@/lib/validation/job";

export async function generateMetadata({ params }: PageProps<"/[lang]/jobs">): Promise<Metadata> {
  return staticPageMetadata("jobs", (await params).lang);
}

export default async function FindJobsPage({ params, searchParams }: PageProps<"/[lang]/jobs">) {
  const [{ lang }, rawParams] = await Promise.all([params, searchParams]);
  const [occupations, industries, countries, currencies] = await Promise.all([
    getOccupations(),
    getIndustries(),
    getCountries(),
    getCurrencies(),
  ]);
  const { filters, errors } = parseSearchParams(resolvePlace(rawParams, countries));
  const ignored = Object.values(errors);
  // The home search names its place in one field; the address of the filters it stands for replaces it, so that the
  // address can be shared and the form shows the country or the city.
  if (rawParams.where !== undefined && ignored.length === 0) redirect(searchPath(lang, filters));
  const selected = jobIdSchema.safeParse(Array.isArray(rawParams.job) ? rawParams.job[0] : rawParams.job);
  const chips = filterChips(lang, filters, {
    countries: new Map(countries.map(({ code, name }) => [code, name])),
    occupations: new Map(occupations.map(({ code, label }) => [code, `${code} · ${label}`])),
    industries: new Map(industries.map(({ code, name }) => [code, name])),
  });

  // The search bar and the filters stay at the top of the screen from 768 px while the list scrolls; on a phone they
  // would take half of it.
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
      <PageHeader title="Find jobs" className="animate-rise" />

      <div className="-mx-4 grid gap-3 bg-background/95 px-4 py-3 sm:-mx-6 sm:px-6 md:sticky md:top-0 md:z-20">
        <JobSearchForm
          lang={lang}
          query={searchQuery({ ...filters, cursor: undefined })}
          occupations={occupations}
          industries={industries}
          countries={countries}
          currencies={currencies}
        />
        <ActiveFilters chips={chips} />
      </div>

      {ignored.length > 0 ? (
        <Notice tone="warning" role="alert">
          <p className="font-semibold">Some search options were ignored</p>
          <ul className="list-disc ps-5">
            {ignored.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <Suspense key={searchQuery(filters)} fallback={<LoadingSkeleton rows={5} />}>
        <JobResults lang={lang} filters={filters} />
      </Suspense>
      {selected.success ? (
        <Suspense key={selected.data} fallback={null}>
          <JobDialog id={selected.data} lang={lang} closeHref={searchPath(lang, filters)} />
        </Suspense>
      ) : null}
    </div>
  );
}
