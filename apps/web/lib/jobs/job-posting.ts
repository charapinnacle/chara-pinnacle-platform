import type { PublicJob } from "@/lib/dal/hiring";
import { employmentTypes, salaryPeriods } from "@/lib/validation/job";

const employmentTypeValues: Record<(typeof employmentTypes)[number], string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACTOR",
  temporary: "TEMPORARY",
  seasonal: "TEMPORARY",
};

const salaryUnits: Record<(typeof salaryPeriods)[number], string> = { hour: "HOUR", month: "MONTH", year: "YEAR" };

// The JobPosting markup for search engines (schema.org). It holds what the page shows and nothing else: the employer by
// its display name, never the legal name. The result goes into a script block, so "<" is escaped and the text cannot
// close the block.
export function jobPostingJsonLd(job: PublicJob): string {
  const { salaryMin, salaryMax, salaryCurrency, salaryPeriod } = job;
  const hasSalary = (salaryMin !== null || salaryMax !== null) && salaryCurrency !== null && salaryPeriod !== null;
  const posting = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description,
    datePosted: new Date(job.publishedAt).toISOString(),
    hiringOrganization: { "@type": "Organization", name: job.employer.displayName },
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: job.city, addressCountry: job.countryCode },
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
