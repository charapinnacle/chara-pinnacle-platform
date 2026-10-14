import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Band } from "@/components/home/band";
import { ClosingCall } from "@/components/home/closing-call";
import { Hero } from "@/components/home/hero";
import { Network } from "@/components/home/network";
import { PassportSection } from "@/components/home/passport-section";
import { WhoAreYou } from "@/components/home/who-are-you";
import { FooterColumns } from "@/components/layout/footer-links";
import { SiteFooter } from "@/components/layout/site-footer";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import { employerSteps, workerSteps } from "@/lib/public/steps";

const html = renderToStaticMarkup;
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const NOW = new Date("2026-10-14T12:00:00.000Z");
const COMPANY_SIGN_UP = "/en/signup?kind=company";

// What Phase 1 does not have (HANDOFF.md) and the claims the audit of U71 removed: none of it may be said on the home page.
const NEVER_SAID = [
  "recruitment",
  "Recruitment",
  "staffing",
  "Staffing",
  "CHARA Match",
  "corridor",
  "Verified",
  "verified",
  "message",
  "Popular searches",
  "Data stored in the EU",
  "moderated",
  "Built for hiring across borders",
  "Latest jobs",
  "Browse by",
];

const sections = () => [
  html(<Hero lang="en" postJobHref={COMPANY_SIGN_UP} />),
  html(<WhoAreYou lang="en" />),
  html(<Network lang="en" now={NOW} />),
  html(<PassportSection lang="en" />),
  html(<ClosingCall lang="en" postJobHref={COMPANY_SIGN_UP} />),
];

describe("the hero", () => {
  const markup = html(<Hero lang="en" postJobHref={COMPANY_SIGN_UP} />);

  it("holds the one h1, the client's line, the search and Post a Job as a secondary button", () => {
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1 id="home-heading"[^>]*>The Global Workforce Network<\/h1>/);
    expect(textOf(markup)).toContain("Connect with the people and companies that can build your workforce.");
    expect(markup).toContain('role="search"');
    const post = /<a [^>]*href="\/en\/signup\?kind=company"[^>]*>Post a Job<\/a>/.exec(markup)?.[0] ?? "";
    expect(post).toContain("bg-card");
    expect(post).not.toContain("bg-primary ");
  });

  it("sends a signed-in employer to /post-job and offers no Post a Job to whom the header offers none", () => {
    expect(html(<Hero lang="en" postJobHref="/en/post-job" />)).toMatch(/<a [^>]*href="\/en\/post-job"[^>]*>Post a Job<\/a>/);
    const none = html(<Hero lang="en" postJobHref={null} />);
    expect(none).not.toContain("Hiring?");
    expect(none).not.toContain("Post a Job");
    expect(none).toContain('role="search"');
  });
});

describe("Who are you?", () => {
  const markup = html(<WhoAreYou lang="en" />);

  it("names the employer, then the worker, as the client's structure orders them, each with its line", () => {
    expect([...markup.matchAll(/<h3 id="(home-[a-z]+-heading)"[^>]*>([^<]+)<\/h3>/g)].map(([, id, title]) => `${id} ${title}`)).toEqual([
      "home-employer-heading Employer",
      "home-worker-heading Worker",
    ]);
    expect(textOf(markup)).toContain("Find the workforce you need.");
    expect(textOf(markup)).toContain("Find jobs and build your professional workforce profile.");
  });

  it("lists the steps of How it works for each side in order, from the one source of that page", () => {
    const lists = [...markup.matchAll(/<ol[^>]*>(.*?)<\/ol>/g)].map(([, list]) => [...list.matchAll(/<h4 class="text-h3">([^<]+)<\/h4>/g)].map(([, title]) => title));
    expect(lists).toEqual([employerSteps.map(({ title }) => title), workerSteps.map(({ title }) => title)]);
    for (const { text } of [...employerSteps, ...workerSteps]) expect(markup).toContain(text);
    expect(markup).toMatch(/<a [^>]*href="\/en\/how-it-works"[^>]*>How Chara Pinnacle works<\/a>/);
  });

  it("says one fact the product enforces for each side and offers one sign-up button each", () => {
    expect(textOf(markup)).toContain("Two-step verification is required for owners and administrators.");
    expect(textOf(markup)).toContain("Workers never pay.");
    expect(markup).toMatch(/<a [^>]*href="\/en\/signup\?kind=company"[^>]*>I&#x27;m an employer<\/a>/);
    expect(markup).toMatch(/<a [^>]*href="\/en\/signup\?kind=worker"[^>]*>I&#x27;m a worker<\/a>/);
  });
});

describe("the network", () => {
  const markup = html(<Network lang="en" now={NOW} />);
  const preview = /<div inert="" aria-hidden="true"[^>]*>(.*)<\/div><figcaption/.exec(markup)?.[1] ?? "";

  it("explains how a worker and an employer connect, in Phase 1 terms", () => {
    expect(markup).toMatch(/<h2 id="home-network-heading"[^>]*>Workers and employers, connected<\/h2>/);
    expect(textOf(markup)).toContain("chooses which documents to share");
    expect(textOf(markup)).toContain("journey tracker");
  });

  it("draws the employer's stage table and the worker's applications with the components of the real dashboards, inert and without links", () => {
    expect(preview).not.toBe("");
    expect([...preview.matchAll(/<th scope="row"[^>]*>([^<]+)<\/th>/g)].map(([, label]) => label)).toEqual([...Object.values(applicationStatusLabels), "Total"]);
    expect(preview).toMatch(/<th scope="row"[^>]*>Total<\/th><td[^>]*>43<\/td>/);
    expect(textOf(preview)).toContain("TIG welder Northwind Shipyard Interview");
    expect(preview).toContain(">Updated 2 hours ago<");
    expect(preview).not.toContain("<a ");
    expect(preview).not.toContain("View all applications");
  });

  it("says that the screens hold fictional data, outside the inert picture so that everyone reads it", () => {
    expect(markup).toMatch(/<figcaption[^>]*>Screens of Chara Pinnacle, shown with fictional data.<\/figcaption>/);
  });
});

describe("the CHARA Passport", () => {
  const markup = html(<PassportSection lang="en" />);

  it("has the client's line, what the passport holds, and how its documents are shared", () => {
    expect(markup).toMatch(/<h2 id="home-passport-heading"[^>]*>One professional profile. Multiple opportunities.<\/h2>/);
    const held = /<ul aria-label="What your CHARA Passport holds"[^>]*>(.*?)<\/ul>/.exec(markup)?.[1] ?? "";
    expect([...held.matchAll(/<li[^>]*>([^<]+)<\/li>/g)].map(([, item]) => item)).toEqual([
      "Occupation and experience",
      "Skills and languages",
      "Availability",
      "Preferred countries",
      "Work authorisation",
      "CV and certificates",
    ]);
    expect(textOf(markup)).toContain("You choose which ones an employer sees, application by application.");
    expect(textOf(markup)).toContain("it is recorded in your access log");
    expect(markup).toMatch(/<a [^>]*href="\/en\/signup\?kind=worker"[^>]*>Create your CHARA Passport<\/a>/);
  });
});

describe("the closing call", () => {
  it("sets the client's line on the near-black band with Join Chara Pinnacle and Start hiring", () => {
    const markup = html(<ClosingCall lang="en" postJobHref={COMPANY_SIGN_UP} />);
    expect(markup).toMatch(/^<section aria-labelledby="home-start-heading" class="dark /);
    expect(markup).toMatch(/<h2 id="home-start-heading"[^>]*>Your Workforce. Your Network. One Platform.<\/h2>/);
    expect(markup).toMatch(/<a [^>]*href="\/en\/signup"[^>]*>Join Chara Pinnacle<\/a>/);
    expect(markup).toMatch(/<a [^>]*href="\/en\/signup\?kind=company"[^>]*>Start hiring<\/a>/);
    expect(html(<ClosingCall lang="en" postJobHref="/en/post-job" />)).toMatch(/<a [^>]*href="\/en\/post-job"[^>]*>Start hiring<\/a>/);
    expect(html(<ClosingCall lang="en" postJobHref={null} />)).not.toContain("Start hiring");
  });
});

describe("every section of the home page", () => {
  it("says nothing of a later phase and none of the claims the audit removed", () => {
    for (const markup of sections()) {
      for (const phrase of NEVER_SAID) expect(textOf(markup), phrase).not.toContain(phrase);
    }
  });

  it("holds no photograph, no style attribute, no gradient and no arbitrary shadow, radius or size", () => {
    for (const markup of sections()) {
      expect(markup).not.toMatch(/<(img|picture|svg)\b(?![^>]*aria-hidden)/);
      expect(markup).not.toMatch(/\sstyle=/);
      expect(markup).not.toMatch(/gradient|shadow-\[|rounded-\[|text-\[|rounded-(2xl|3xl)/);
    }
  });

  it("sets the sections on hairlines in the page column, not on coloured bands", () => {
    const band = html(<Band aria-labelledby="x">x</Band>);
    expect(band).toMatch(/^<section class="border-t" aria-labelledby="x"><div class="mx-auto w-full max-w-6xl px-4 sm:px-6 py-20 sm:py-28">/);
    expect(band).not.toMatch(/\bdark\b/);
  });
});

describe("the footer", () => {
  it("has three named columns of links, the first title being a paragraph, not a heading, and no photo credits", () => {
    const markup = html(<FooterColumns lang="en" />);
    expect(markup.startsWith('<nav aria-label="Footer"')).toBe(true);
    expect(markup).not.toMatch(/<h[1-6]/);
    expect([...markup.matchAll(/<ul aria-labelledby="(footer-[a-z]+)"/g)].map(([, id]) => id)).toEqual([
      "footer-platform",
      "footer-company",
      "footer-legal",
    ]);
    expect(markup).not.toContain("Photo credits");
    expect(markup).toContain('href="/en/legal"');
  });

  it("keeps the logo and the copyright line when a page gives it no links", () => {
    const markup = html(<SiteFooter />);
    expect(markup).toContain("Chara Pinnacle");
    expect(markup).toContain(`© ${new Date().getFullYear()} Chara Pinnacle`);
    expect(markup).not.toContain("<nav");
  });
});
