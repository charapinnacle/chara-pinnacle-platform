import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SavedList } from "@/components/saved/saved-list";
import type { ApplicationState } from "@/lib/dal/applications";
import type { SavedJob } from "@/lib/dal/saved-jobs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/saved-jobs", () => ({ setSavedJob: async () => ({}) }));

const savedAt = "2026-10-06T10:00:00.123456+00:00";
const visible = (id: string, status: "open" | "paused" | "closed" | "filled", title: string): SavedJob => ({
  id,
  savedAt,
  available: true,
  status,
  title,
  employerName: "Acme Bau",
});
const withdrawn: SavedJob = { id: "hidden-id", savedAt, available: false };

const render = (
  jobs: SavedJob[],
  nextHref: string | null = null,
  firstHref: string | null = null,
  applications: Record<string, ApplicationState> = {},
) => renderToStaticMarkup(<SavedList lang="en" jobs={jobs} applications={applications} nextHref={nextHref} firstHref={firstHref} />);

describe("SavedList", () => {
  it("flags an open vacancy as Open, links its title to its page and offers Quick apply to the application step", () => {
    const html = render([visible("job-1", "open", "Open welder")]);
    expect(html).toContain(">Open</span>");
    expect(html).not.toContain("No longer open");
    expect(html.match(/href="\/en\/jobs\/job-1"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/en\/jobs\/job-1\/apply"[^>]*>Quick apply<span class="sr-only"> for Open welder<\/span>/);
    expect(html).toContain("Acme Bau");
    expect(html).not.toContain("Applied");
  });

  it("marks a vacancy with an application as Applied and links the application instead of Quick apply", () => {
    const html = render([visible("job-1", "open", "Open welder")], null, null, {
      "job-1": { id: "app-1", status: "shortlisted", createdAt: savedAt },
    });
    expect(html).toContain(">Applied</span>");
    expect(html).toMatch(/href="\/en\/applications\/app-1"[^>]*>View your application/);
    expect(html).not.toContain("Quick apply");
  });

  it("flags a paused, closed or filled vacancy as no longer open, with title and employer and no link to the page", () => {
    for (const status of ["paused", "closed", "filled"] as const) {
      const html = render([visible("job-2", status, "Gone welder")]);
      expect(html, status).toContain("No longer open");
      expect(html, status).toContain("Gone welder");
      expect(html, status).toContain("Acme Bau");
      expect(html, status).not.toContain("/en/jobs/job-2");
      expect(html, status).not.toContain("Quick apply");
    }
  });

  it("shows a withdrawn vacancy as unavailable with no title, employer, flag or link", () => {
    const html = render([withdrawn]);
    expect(html).toContain("This vacancy is no longer available");
    expect(html).not.toContain("Acme");
    expect(html).not.toContain("No longer open");
    expect(html).not.toContain("/en/jobs/");
    expect(html).not.toContain("Quick apply");
    expect(html).toContain("Unsave");
  });

  it("gives every row its own Unsave button that names the vacancy", () => {
    const html = render([visible("a", "open", "First"), visible("b", "closed", "Second"), withdrawn]);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain("Unsave<span class=\"sr-only\"> vacancy: First</span>");
    expect(html).toContain("Unsave<span class=\"sr-only\"> vacancy: Second</span>");
    expect(html).toContain("Unsave<span class=\"sr-only\"> vacancy: no longer available</span>");
  });

  it("shows the text of a vacancy as text", () => {
    const html = render([visible("a", "open", "<img src=x onerror=alert(1)>")]);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });

  it("shows the next page and the first page controls only when there is a page to go to", () => {
    expect(render([withdrawn])).not.toContain("Next page");
    expect(render([withdrawn])).not.toContain("first page");
    const html = render([withdrawn], "/en/saved?cursor=c", "/en/saved");
    expect(html).toContain('href="/en/saved?cursor=c"');
    expect(html).toContain("Next page");
    expect(html).toContain('href="/en/saved"');
  });

  it("shows the empty state with a link to Find Jobs when nothing is saved", () => {
    const html = render([]);
    expect(html).toContain("No saved vacancies yet");
    expect(html).toContain('href="/en/jobs"');
    expect(html).toContain("Find Jobs");
    expect(html).not.toContain("<ul");
  });

  it("does not claim that nothing is saved on a page of the list that has run out", () => {
    const html = render([], null, "/en/saved");
    expect(html).not.toContain("No saved vacancies yet");
    expect(html).toContain("No more saved vacancies on this page");
    expect(html).toContain('href="/en/saved"');
  });
});
