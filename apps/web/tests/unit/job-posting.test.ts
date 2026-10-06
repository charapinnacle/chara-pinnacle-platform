import { describe, expect, it } from "vitest";
import type { PublicJob } from "@/lib/dal/hiring";
import { jobPostingJsonLd } from "@/lib/jobs/job-posting";

const job: PublicJob = {
  id: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11",
  title: "Welder MIG/MAG",
  description: "We build steel frames.\nExperience with MIG and MAG welding is needed.",
  occupation: "Welders and flame cutters",
  industry: "Manufacturing",
  country: "Germany",
  countryCode: "DE",
  city: "Hamburg",
  employmentType: "full_time",
  salaryMin: 2800,
  salaryMax: 3400,
  salaryCurrency: "EUR",
  salaryPeriod: "month",
  accommodation: true,
  visaSupport: true,
  recruitmentPreference: "both",
  publishedAt: "2026-10-06T10:00:00.123456+00:00",
  employer: { displayName: "Acme", country: "Germany", industry: "Construction", website: "https://acme.example" },
};

const parse = (value: PublicJob) => JSON.parse(jobPostingJsonLd(value)) as Record<string, unknown>;

describe("jobPostingJsonLd", () => {
  it("is a JobPosting with the title, description, date, employer, place and employment type", () => {
    expect(parse(job)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Welder MIG/MAG",
      description: job.description,
      datePosted: "2026-10-06T10:00:00.123Z",
      hiringOrganization: { "@type": "Organization", name: "Acme" },
      jobLocation: { address: { addressLocality: "Hamburg", addressCountry: "DE" } },
      employmentType: "FULL_TIME",
    });
  });

  it("has a base salary with currency, both amounts and the unit of the pay period", () => {
    expect(parse(job).baseSalary).toEqual({
      "@type": "MonetaryAmount",
      currency: "EUR",
      value: { "@type": "QuantitativeValue", minValue: 2800, maxValue: 3400, unitText: "MONTH" },
    });
  });

  it("has only the minimum when only the minimum is set, and no base salary without a salary", () => {
    const minimumOnly = parse({ ...job, salaryMax: null }).baseSalary as { value: Record<string, unknown> };
    expect(minimumOnly.value).toEqual({ "@type": "QuantitativeValue", minValue: 2800, unitText: "MONTH" });
    const none = parse({ ...job, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null });
    expect(none).not.toHaveProperty("baseSalary");
  });

  it("maps the units of the pay period", () => {
    const unit = (salaryPeriod: PublicJob["salaryPeriod"]) =>
      (parse({ ...job, salaryPeriod }).baseSalary as { value: { unitText: string } }).value.unitText;
    expect([unit("hour"), unit("month"), unit("year")]).toEqual(["HOUR", "MONTH", "YEAR"]);
  });

  it("maps the five employment types, seasonal to TEMPORARY", () => {
    const types = ["full_time", "part_time", "contract", "temporary", "seasonal"] as const;
    expect(types.map((employmentType) => parse({ ...job, employmentType }).employmentType)).toEqual([
      "FULL_TIME",
      "PART_TIME",
      "CONTRACTOR",
      "TEMPORARY",
      "TEMPORARY",
    ]);
  });

  it("escapes the less-than sign so that a description cannot close the script block", () => {
    const hostile = { ...job, description: "</script><script>alert(1)</script>" };
    const output = jobPostingJsonLd(hostile);
    expect(output).not.toContain("<");
    expect(JSON.parse(output).description).toBe(hostile.description);
  });

  it("holds the display name of the employer and no other company data", () => {
    const output = jobPostingJsonLd({ ...job, employer: { ...job.employer, displayName: "Acme" } });
    expect(output).not.toContain("GmbH");
    expect(output).not.toContain("acme.example");
    expect(output).not.toContain("Construction");
  });
});
