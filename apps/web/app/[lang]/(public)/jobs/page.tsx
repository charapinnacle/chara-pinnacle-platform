import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { JobResults } from "@/components/jobs/job-results";
import { JobSearchForm } from "@/components/jobs/job-search-form";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { getCountries, getCurrencies, getIndustries, getOccupations } from "@/lib/dal/reference";
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

  return (
    <PageContainer layout="page" className="grid max-w-4xl gap-8">
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

      <JobSearchForm
        lang={lang}
        query={searchQuery({ ...filters, cursor: undefined })}
        occupations={occupations}
        industries={industries}
        countries={countries}
        currencies={currencies}
      />

      <Suspense key={searchQuery(filters)} fallback={<LoadingSkeleton rows={5} />}>
        <JobResults lang={lang} filters={filters} />
      </Suspense>
    </PageContainer>
  );
}
