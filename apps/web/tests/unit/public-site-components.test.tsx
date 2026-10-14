import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroSearch } from "@/components/home/hero-search";
import { FactList } from "@/components/public/fact-list";
import { NumberedSteps } from "@/components/public/numbered-steps";
import { SectionHeading } from "@/components/public/section-heading";
import { StepList } from "@/components/public/step-list";
import { workerSteps } from "@/lib/public/steps";

const html = renderToStaticMarkup;

describe("HeroSearch", () => {
  it("is a GET search form to Find Jobs with a labelled What field (the keyword) and Where field (the place)", () => {
    const markup = html(<HeroSearch lang="en" />);
    const form = /^<form [^>]*>/.exec(markup)?.[0] ?? "";
    for (const attribute of ['action="/en/jobs"', 'method="get"', 'role="search"', 'aria-label="Search jobs"']) {
      expect(form).toContain(attribute);
    }
    for (const [id, name] of [
      ["hero-what", "q"],
      ["hero-where", "where"],
    ]) {
      expect(markup).toContain(`<label for="${id}"`);
      const input = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(markup)?.[0] ?? "";
      expect(input).toContain(`name="${name}"`);
      expect(input).toContain('maxLength="100"');
    }
    // The visible word starts the accessible name and the hint, which the placeholder shows, completes it (WCAG 2.5.3).
    expect(markup).toMatch(/<label for="hero-what"[^>]*>What<span class="sr-only">: Job title, skill or occupation<\/span><\/label>/);
    expect(markup).toMatch(/<label for="hero-where"[^>]*>Where<span class="sr-only">: City or country<\/span><\/label>/);
    expect(markup).toMatch(/<input[^>]*id="hero-what"[^>]*placeholder="Job title, skill or occupation"/);
    expect(markup).not.toContain("<svg");
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>Search jobs<\/button>/);
  });
});

describe("StepList", () => {
  it("numbers the steps in order with the number hidden from assistive technology, the list itself being ordered", () => {
    const markup = html(<StepList steps={workerSteps} />);
    expect(markup.startsWith("<ol")).toBe(true);
    expect(markup.match(/<li/g)).toHaveLength(4);
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*>1<\/span><div[^>]*><h3[^>]*>Create your profile<\/h3>/);
    expect(markup.indexOf("Search vacancies")).toBeLessThan(markup.indexOf("Follow your application"));
  });
});

describe("SectionHeading", () => {
  it("names its section through the id of its h2 and keeps the eyebrow out of the heading, in the section size", () => {
    const markup = html(<SectionHeading id="s" eyebrow="How it works" title="In three steps." />);
    expect(markup).toMatch(/<p class="[^"]*text-brand-ink[^"]*">How it works<\/p><h2 id="s" class="[^"]*text-section[^"]*">In three steps.<\/h2><\/div>$/);
  });
});

describe("NumberedSteps", () => {
  it("is an ordered list of h3 titles with one line each, the number hidden from assistive technology", () => {
    const markup = html(<NumberedSteps steps={[{ title: "One", text: "First line." }, { title: "Two", text: "Second line." }]} />);
    expect(markup.startsWith("<ol")).toBe(true);
    expect(markup).toMatch(/<li[^>]*><span aria-hidden="true"[^>]*>1<\/span><h3[^>]*>One<\/h3><p[^>]*>First line.<\/p><\/li>/);
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*>2<\/span><h3[^>]*>Two<\/h3>/);
  });
});

describe("FactList", () => {
  it("is a named list of a title and a line per fact between hairlines", () => {
    const markup = html(<FactList label="Facts" facts={[{ title: "Free", text: "Workers never pay." }]} />);
    expect(markup).toMatch(/^<ul aria-label="Facts" class="border-b"><li class="[^"]*border-t[^"]*"><p[^>]*>Free<\/p><p[^>]*>Workers never pay.<\/p><\/li><\/ul>$/);
  });
});
