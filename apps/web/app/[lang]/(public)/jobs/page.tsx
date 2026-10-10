import type { Metadata } from "next";
import { Suspense } from "react";
import { ActiveFilters } from "@/components/jobs/active-filters";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { JobResults } from "@/components/jobs/job-results";
import { JobSearchForm } from "@/components/jobs/job-search-form";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { getCountries, getCurrencies, getIndustries, getOccupations } from "@/lib/dal/reference";
import { filterChips } from "@/lib/jobs/filter-chips";
import { parseSearchParams, searchQuery } from "@/lib/jobs/search-params";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/jobs">): Promise<Metadata> {
  return staticPageMetadata("jobs", (await params).lang);
}

export default async function FindJobsPage({ params, searchParams }: PageProps<"/[lang]/jobs">) {
  const [{ lang }, rawParams] = await Promise.all([params, searchParams]);
  const { filters, errors } = parseSearchParams(rawParams);
  const [occupations, industries, countries, currencies] = await Promise.all([
    getOccupations(),
    getIndustries(),
    getCountries(),
    getCurrencies(),
  ]);
  const ignored = Object.values(errors);
  const chips = filterChips(lang, filters, {
    countries: new Map(countries.map(({ code, name }) => [code, name])),
    occupations: new Map(occupations.map(({ code, label }) => [code, `${code} · ${label}`])),
    industries: new Map(industries.map(({ code, name }) => [code, name])),
  });

  return (
    <PageContainer layout="page" className="grid gap-section">
      <PageHeader title="Find jobs" description="Open vacancies from employers on CHARA." />

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

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-10">
        <JobSearchForm
          lang={lang}
          query={searchQuery({ ...filters, cursor: undefined })}
          occupations={occupations}
          industries={industries}
          countries={countries}
          currencies={currencies}
        />
        <div className="grid gap-4">
          <ActiveFilters chips={chips} />
          <Suspense key={searchQuery(filters)} fallback={<LoadingSkeleton rows={5} />}>
            <JobResults lang={lang} filters={filters} />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}
