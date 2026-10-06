import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VacancyActions } from "@/components/jobs/vacancy-actions";
import { VacancyView } from "@/components/jobs/vacancy-view";
import type { PublicJob } from "@/lib/dal/hiring";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/vacancy", () => ({ requireLogin: async () => undefined }));

const jobId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const job: PublicJob = {
  id: jobId,
  title: "<img src=x onerror=alert(1)>",
  description: "<script>alert(1)</script> see https://example.com/apply\nsecond line",
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
  publishedAt: "2026-10-06T10:00:00+00:00",
  employer: { displayName: "Acme", country: "Germany", industry: "Construction", website: "https://acme.example" },
};

const render = (value: PublicJob) =>
  renderToStaticMarkup(<VacancyView job={value} employer={value.employer} publishedAt={value.publishedAt} />);

describe("VacancyView", () => {
  it("shows the text of the vacancy as text: no element is made of it and an address in it is not a link", () => {
    const html = render(job);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('href="https://example.com/apply"');
  });

  it("shows the title as the only h1, the date of publication and the employer card", () => {
    const html = render(job);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<time dateTime="2026-10-06T10:00:00+00:00">October 6, 2026</time>');
    expect(html).toContain("Acme");
    expect(html).toContain("Based in Germany");
    expect(html).toContain("Industry: Construction");
    expect(html).toContain('href="https://acme.example/"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("does not link a website of another scheme", () => {
    const html = render({ ...job, employer: { ...job.employer, website: "javascript:alert(1)" } });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
  });

  it("shows no employer card, date or actions when the page gives none", () => {
    const html = renderToStaticMarkup(<VacancyView job={job} />);
    expect(html).not.toContain("Based in");
    expect(html).not.toContain("Published");
    expect(html).not.toContain("<button");
  });
});

describe("VacancyActions", () => {
  it("offers a visitor Apply and Save as buttons that submit a form", () => {
    const html = renderToStaticMarkup(<VacancyActions jobId={jobId} viewer="visitor" />);
    expect(html.match(/<form/g)).toHaveLength(2);
    expect(html).toMatch(/<button(?![^>]*\sdisabled=)[^>]*>Apply<\/button>/);
    expect(html).toMatch(/<button(?![^>]*\sdisabled=)[^>]*>Save<\/button>/);
  });

  it("offers a company user neither button and says why", () => {
    const html = renderToStaticMarkup(<VacancyActions jobId={jobId} viewer="company" />);
    expect(html).not.toContain("<button");
    expect(html).toContain("Only candidates can apply");
  });

  it("shows a candidate both buttons switched off until their units exist", () => {
    const html = renderToStaticMarkup(<VacancyActions jobId={jobId} viewer="candidate" />);
    expect(html.match(/<button[^>]*\sdisabled=/g)).toHaveLength(2);
  });
});
