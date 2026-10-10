import type { PublicJob } from "@/lib/dal/hiring";
import { formatIsoDate } from "@/lib/i18n/format";
import { employmentTypes, salaryPeriods } from "@/lib/validation/job";

const employmentTypeValues: Record<(typeof employmentTypes)[number], string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACTOR",
  temporary: "TEMPORARY",
  seasonal: "TEMPORARY",
};

const salaryUnits: Record<(typeof salaryPeriods)[number], string> = { hour: "HOUR", month: "MONTH", year: "YEAR" };

// What the markup is built from: the public fields of an open vacancy and nothing else. Every field of the markup is
// named below, so an id, a user or an applicant that a caller passes along is never copied.
type JobPostingSource = Pick<
  PublicJob,
  | "title"
  | "description"
  | "createdAt"
  | "countryCode"
  | "employmentType"
  | "salaryMin"
  | "salaryMax"
  | "salaryCurrency"
  | "salaryPeriod"
> & { city: string | null; employer: Pick<PublicJob["employer"], "displayName" | "website"> };

// The JobPosting markup for search engines (schema.org). It holds what the page shows and nothing else: the employer by
// its display name, never the legal name. The result goes into a script block, so "<" is escaped and the text cannot
// close the block. There is no validThrough: a vacancy has no closing date, and a closed one leaves the sitemap.
export function jobPostingJsonLd(job: JobPostingSource): string {
  const { salaryMin, salaryMax, salaryCurrency, salaryPeriod } = job;
  const hasSalary = (salaryMin !== null || salaryMax !== null) && salaryCurrency !== null && salaryPeriod !== null;
  const posting = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description,
    datePosted: formatIsoDate(job.createdAt),
    hiringOrganization: {
      "@type": "Organization",
      name: job.employer.displayName,
      ...(job.employer.website ? { sameAs: job.employer.website } : {}),
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        ...(job.city ? { addressLocality: job.city } : {}),
        addressCountry: job.countryCode,
      },
    },
    employmentType: employmentTypeValues[job.employmentType],
    ...(hasSalary
      ? {
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: salaryCurrency,
            value: {
              "@type": "QuantitativeValue",
              ...(salaryMin !== null ? { minValue: salaryMin } : {}),
              ...(salaryMax !== null ? { maxValue: salaryMax } : {}),
              unitText: salaryUnits[salaryPeriod],
            },
          },
        }
      : {}),
  };
  return JSON.stringify(posting).replaceAll("<", "\\u003c");
}
