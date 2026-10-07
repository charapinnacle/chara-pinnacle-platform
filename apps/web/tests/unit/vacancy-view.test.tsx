import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VacancyActions } from "@/components/jobs/vacancy-actions";
import { VacancyView } from "@/components/jobs/vacancy-view";
import type { ApplicationState } from "@/lib/dal/applications";
import type { PublicJob } from "@/lib/dal/hiring";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/vacancy", () => ({ requireLogin: async () => undefined }));
vi.mock("@/lib/actions/saved-jobs", () => ({ setSavedJob: async () => ({}) }));

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

const actions = (viewer: "visitor" | "candidate" | "company", saved = false, application: ApplicationState | null = null) =>
  renderToStaticMarkup(
    <VacancyActions job={{ id: jobId, title: "Welder" }} lang="en" viewer={viewer} saved={saved} application={application} />,
  );

describe("VacancyActions", () => {
  it("offers a visitor Apply and Save as buttons that submit a form", () => {
    const html = actions("visitor");
    expect(html.match(/<form/g)).toHaveLength(2);
    expect(html).toMatch(/<button(?![^>]*\sdisabled=)[^>]*>Apply<\/button>/);
    expect(html).toMatch(/<button(?![^>]*\sdisabled=)[^>]*aria-label="Save vacancy: Welder"[^>]*>.*Save<\/button>/);
  });

  it("offers a company user neither button and says why", () => {
    const html = actions("company");
    expect(html).not.toContain("<button");
    expect(html).toContain("Only candidates can apply");
  });

  it("gives a candidate with no application an Apply link to the application step and a working Save", () => {
    const html = actions("candidate");
    expect(html).toMatch(new RegExp(`<a[^>]*href="/en/jobs/${jobId}/apply"[^>]*>Apply</a>`));
    expect(html).not.toContain("<form");
    expect(html).toMatch(/<button(?![^>]*\sdisabled=)[^>]*aria-pressed="false"[^>]*aria-label="Save vacancy: Welder"[^>]*>.*Save<\/button>/);
    expect(html).not.toContain("Applying opens soon");
  });

  it("shows the date and stage of a non-withdrawn application with a link to it and no Apply", () => {
    const html = actions("candidate", false, { id: "app-1", status: "shortlisted", createdAt: "2026-10-03T09:00:00+00:00" });
    expect(html).toContain("You applied on 3 Oct 2026, stage Shortlisted");
    expect(html).toMatch(/<a[^>]*href="\/en\/applications\/app-1"[^>]*>View your application<\/a>/);
    expect(html).not.toContain(">Apply<");
    expect(html).not.toContain("Apply again");
  });

  it("says Not selected for a rejected application", () => {
    expect(actions("candidate", false, { id: "app-1", status: "rejected", createdAt: "2026-10-03T09:00:00+00:00" })).toContain(
      "stage Not selected",
    );
  });

  it("offers Apply again after a withdrawal", () => {
    const html = actions("candidate", false, { id: "app-1", status: "withdrawn", createdAt: "2026-10-03T09:00:00+00:00" });
    expect(html).toContain("You withdrew your application");
    expect(html).toMatch(new RegExp(`<a[^>]*href="/en/jobs/${jobId}/apply"[^>]*>Apply again</a>`));
    expect(html).not.toContain("View your application");
  });

  it("shows the Save of a vacancy the candidate saved as pressed and says Saved", () => {
    const html = actions("candidate", true);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Saved<\/button>/);
  });
});
