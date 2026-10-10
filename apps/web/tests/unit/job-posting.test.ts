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
  publishedAt: "2026-10-08T10:00:00.123456+00:00",
  createdAt: "2026-10-06T10:00:00.123456+00:00",
  employer: { displayName: "Acme", country: "Germany", industry: "Construction", website: "https://acme.example" },
};

const parse = (value: Parameters<typeof jobPostingJsonLd>[0]) => JSON.parse(jobPostingJsonLd(value)) as Record<string, unknown>;

describe("jobPostingJsonLd", () => {
  it("is a JobPosting with the title, description, date, employer, place and employment type", () => {
    expect(parse(job)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Welder MIG/MAG",
      description: job.description,
      datePosted: "2026-10-06",
      hiringOrganization: { "@type": "Organization", name: "Acme", sameAs: "https://acme.example" },
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

  it("holds the display name and the website of the employer and no other company data", () => {
    const output = jobPostingJsonLd({ ...job, employer: { ...job.employer, displayName: "Acme" } });
    expect(output).not.toContain("GmbH");
    expect(output).not.toContain("Construction");
    expect(parse(job).hiringOrganization).toEqual({ "@type": "Organization", name: "Acme", sameAs: "https://acme.example" });
  });

  it("FR-H5 AC9: leaves out sameAs without a website, the locality without a city and the employment type without a mapping", () => {
    const noWebsite = parse({ ...job, employer: { ...job.employer, website: null } });
    expect(noWebsite.hiringOrganization).toEqual({ "@type": "Organization", name: "Acme" });

    const noCity = parse({ ...job, city: null }).jobLocation as { address: Record<string, unknown> };
    expect(noCity.address).toEqual({ "@type": "PostalAddress", addressCountry: "DE" });

    const unmapped = parse({ ...job, employmentType: "volunteer" as PublicJob["employmentType"] });
    expect(unmapped).not.toHaveProperty("employmentType");
  });

  it("FR-H5 AC9: builds an hourly range and a monthly maximum without converting the amounts", () => {
    const hourly = parse({ ...job, salaryMin: 12, salaryMax: 15, salaryCurrency: "EUR", salaryPeriod: "hour" });
    expect(hourly.baseSalary).toEqual({
      "@type": "MonetaryAmount",
      currency: "EUR",
      value: { "@type": "QuantitativeValue", minValue: 12, maxValue: 15, unitText: "HOUR" },
    });
    const monthly = parse({ ...job, salaryMin: null, salaryMax: 3000, salaryCurrency: "EUR", salaryPeriod: "month" });
    expect(monthly.baseSalary).toEqual({
      "@type": "MonetaryAmount",
      currency: "EUR",
      value: { "@type": "QuantitativeValue", maxValue: 3000, unitText: "MONTH" },
    });
  });

  it("FR-H5 AC8: datePosted is the UTC date of the creation time, not of the publication (the job below is published two days later) or of a local day", () => {
    expect(parse({ ...job, createdAt: "2026-09-01T23:30:00-02:00" }).datePosted).toBe("2026-09-02");
    expect(parse({ ...job, createdAt: "2026-09-01T00:00:00+00:00" }).datePosted).toBe("2026-09-01");
  });

  it("FR-H5 AC8: has no validThrough", () => {
    expect(parse(job)).not.toHaveProperty("validThrough");
  });

  it("FR-H5 AC10: holds only the whitelisted keys, whatever else the caller passes", () => {
    const extra = {
      ...job,
      id: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11",
      organization_id: "0a1b2c3d-0000-4000-8000-000000000002",
      created_by: "0a1b2c3d-0000-4000-8000-000000000003",
      applicant: { name: "Pat Candidate", email: "pat@example.test" },
      occupation: "Welders and flame cutters",
    };
    const output = jobPostingJsonLd(extra);
    expect(Object.keys(JSON.parse(output)).sort()).toEqual([
      "@context",
      "@type",
      "baseSalary",
      "datePosted",
      "description",
      "employmentType",
      "hiringOrganization",
      "jobLocation",
      "title",
    ]);
    for (const leak of [extra.id, extra.organization_id, extra.created_by, "Pat Candidate", "pat@example.test"]) {
      expect(output).not.toContain(leak);
    }
  });

  it("FR-H5 AC10: a title that closes the script block is escaped, so the serialised markup cannot contain the closing tag", () => {
    const hostile = { ...job, title: "</script><script>window.hacked=1</script>" };
    const output = jobPostingJsonLd(hostile);
    expect(output).not.toContain("</script>");
    expect(output).toContain("\\u003c/script>");
    expect(JSON.parse(output).title).toBe(hostile.title);
  });
});
