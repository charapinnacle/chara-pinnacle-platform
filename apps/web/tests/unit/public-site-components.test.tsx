import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OnboardingSteps } from "@/components/consent/onboarding-steps";
import { HeroSearch } from "@/components/home/hero-search";
import { SectionHeading } from "@/components/public/section-heading";
import { StepList } from "@/components/public/step-list";
import { employerSteps, workerSteps } from "@/lib/public/steps";

const html = renderToStaticMarkup;

describe("HeroSearch", () => {
  it("is a GET search form to Find Jobs with labelled keyword and city fields named as the address filters", () => {
    const markup = html(<HeroSearch lang="en" />);
    const form = /^<form [^>]*>/.exec(markup)?.[0] ?? "";
    for (const attribute of ['action="/en/jobs"', 'method="get"', 'role="search"', 'aria-label="Search vacancies"']) {
      expect(form).toContain(attribute);
    }
    for (const [id, name] of [
      ["hero-keyword", "q"],
      ["hero-city", "city"],
    ]) {
      expect(markup).toContain(`<label for="${id}"`);
      const input = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(markup)?.[0] ?? "";
      expect(input).toContain(`name="${name}"`);
      expect(input).toContain('maxLength="100"');
    }
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>Search vacancies<\/button>/);
  });
});

describe("StepList", () => {
  it("numbers the steps in order with the number hidden from assistive technology, the list itself being ordered", () => {
    const markup = html(<StepList steps={workerSteps} />);
    expect(markup.startsWith("<ol")).toBe(true);
    expect(markup.match(/<li/g)).toHaveLength(4);
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*>1<\/span><h3[^>]*>Create your profile<\/h3>/);
    expect(markup.indexOf("Search vacancies")).toBeLessThan(markup.indexOf("Follow your application"));
  });

  it("sets the step titles one level under the heading of the list", () => {
    const markup = html(<StepList steps={employerSteps} titleAs="h4" />);
    expect(markup.match(/<h4/g)).toHaveLength(4);
    expect(markup).not.toContain("<h3");
  });
});

describe("SectionHeading", () => {
  it("names its section through the id of its h2 and keeps the eyebrow out of the heading", () => {
    const markup = html(<SectionHeading id="s" eyebrow="Trust & Safety" title="Built on rules" description="Quiet line" />);
    expect(markup).toMatch(/<p[^>]*>Trust &amp; Safety<\/p><h2 id="s"[^>]*>Built on rules<\/h2><p[^>]*>Quiet line<\/p>/);
  });

  it("uses the gold and the light text of the black surfaces in the inverse tone", () => {
    const markup = html(<SectionHeading id="s" eyebrow="E" title="T" tone="inverse" />);
    expect(markup).toContain("text-brand");
    expect(markup).not.toContain("text-brand-ink");
    expect(markup).toContain("text-inverse-foreground");
  });
});

describe("OnboardingSteps", () => {
  it("marks the current step, says the earlier ones are done, and names the last step by the account kind", () => {
    const markup = html(<OnboardingSteps current={2} kind="company" />);
    expect(markup).toContain('aria-label="Setting up your account"');
    expect(markup.match(/aria-current="step"/g)).toHaveLength(1);
    expect(markup).toMatch(/<li aria-current="step"[^>]*>.*Step 3 of 3: <\/span>Organisation/);
    expect(markup.match(/\(done\)/g)).toHaveLength(2);
    expect(html(<OnboardingSteps current={2} kind="worker" />)).toContain("Passport");
  });

  it("names the last step Profile while the kind is not chosen", () => {
    const markup = html(<OnboardingSteps current={1} kind={null} />);
    expect(markup).toMatch(/<li aria-current="step"[^>]*>.*Account type/);
    expect(markup).toContain("Profile");
    expect(markup.match(/\(done\)/g)).toHaveLength(1);
  });
});
