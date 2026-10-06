import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import JobsError from "@/app/[lang]/(app)/org/[slug]/jobs/error";
import PublicJobsError from "@/app/[lang]/(public)/jobs/error";
import VacancyError from "@/app/[lang]/(public)/jobs/[id]/error";

describe("the vacancy list error boundary", () => {
  it("says what failed, offers a retry button and leaks nothing of the error", () => {
    const html = renderToStaticMarkup(
      <JobsError error={Object.assign(new Error("relation jobs secret detail"), { digest: "d1" })} retry={vi.fn()} />,
    );
    expect(html).toContain("The vacancies could not be loaded");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[^<]*Try again/);
    expect(html).not.toContain("secret");
    expect(html).not.toContain("d1");
  });
});

describe("the public vacancy search error boundary", () => {
  it("says what failed, offers a retry button and leaks nothing of the error", () => {
    const html = renderToStaticMarkup(
      <PublicJobsError error={Object.assign(new Error("function search_jobs secret detail"), { digest: "d2" })} retry={vi.fn()} />,
    );
    expect(html).toContain("The vacancies could not be loaded");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[^<]*Try again/);
    expect(html).not.toContain("secret");
    expect(html).not.toContain("search_jobs");
    expect(html).not.toContain("d2");
  });
});

describe("the public vacancy page error boundary", () => {
  it("names the vacancy, not the list, and leaks nothing of the error", () => {
    const html = renderToStaticMarkup(
      <VacancyError error={Object.assign(new Error("relation jobs secret detail"), { digest: "d3" })} retry={vi.fn()} />,
    );
    expect(html).toContain("The vacancy could not be loaded");
    expect(html).not.toContain("vacancies could not");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[^<]*Try again/);
    expect(html).not.toContain("secret");
    expect(html).not.toContain("d3");
  });
});
