import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Band } from "@/components/public/band";
import { ClosingCall } from "@/components/public/closing-call";
import { Hero } from "@/components/home/hero";
import { PassportSection } from "@/components/home/passport-section";
import { FooterColumns } from "@/components/layout/footer-links";
import { SiteFooter } from "@/components/layout/site-footer";

const html = renderToStaticMarkup;
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const COMPANY_SIGN_UP = "/en/signup?kind=company";

// What Phase 1 does not have (HANDOFF.md) and the claims the audits of U71 and U73 removed: none of it may be said on the
// home page.
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
  "Who are you?",
  "Workers and employers, connected",
  "every opening",
  "Every opening",
];

const sections = () => [
  html(<Hero lang="en" what={[]} countries={[]} />),
  html(<PassportSection />),
  html(<ClosingCall id="home-start-heading" title="Your Workforce. Your Network. One Platform." primary={{ href: "/en/signup", label: "Join Chara Pinnacle" }} />),
];

const headingsOf = (markup: string, level: number) =>
  [...markup.matchAll(new RegExp(`<h${level}[^>]*>([^<]+)</h${level}>`, "g"))].map(([, text]) => text);

describe("the hero", () => {
  const markup = html(<Hero lang="en" what={[]} countries={[]} />);

  it("holds the one h1, the client's line and the search, and no line for employers", () => {
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1 id="home-heading" class="[^"]*text-hero[^"]*">The Global Workforce Network<\/h1>/);
    expect(textOf(markup)).toContain("Connect with the people and companies that can build your workforce.");
    expect(markup).toContain('role="search"');
    expect(textOf(markup)).not.toContain("Hiring?");
    // The search is the one primary action of the hero.
    expect(markup.match(/bg-primary /g)).toHaveLength(1);
    expect(/<button[^>]*>Search jobs<\/button>/.exec(markup)?.[0]).toContain("bg-primary ");
  });

  it("is centred, the search after the line", () => {
    expect(markup).toMatch(/text-center/);
    expect(markup.indexOf("Connect with the people")).toBeLessThan(markup.indexOf('role="search"'));
  });
});

describe("the CHARA Passport", () => {
  const markup = html(<PassportSection />);

  it("has the client's line and the four facts the product enforces, and nothing else", () => {
    expect(markup).toMatch(/<h2 id="home-passport-heading"[^>]*>One professional profile. Multiple opportunities.<\/h2>/);
    const facts = /<ul aria-label="What your CHARA Passport gives you"[^>]*>(.*?)<\/ul>/.exec(markup)?.[1] ?? "";
    expect([...facts.matchAll(/<li[^>]*><p[^>]*>([^<]+)<\/p>/g)].map(([, title]) => title)).toEqual([
      "One profile for every application",
      "You decide who sees your documents",
      "You see who opened them",
      "Workers never pay",
    ]);
    expect(textOf(markup)).toContain("Your access log shows which organisation opened which document, and when.");
    expect(markup).not.toContain("<a ");
  });
});

describe("the closing call", () => {
  it("sets its line centred on the near-black band, the primary action first and the second one an outline", () => {
    const markup = html(
      <ClosingCall
        id="home-start-heading"
        title="Your Workforce. Your Network. One Platform."
        primary={{ href: "/en/signup", label: "Join Chara Pinnacle" }}
        secondary={{ href: COMPANY_SIGN_UP, label: "Start hiring" }}
      />,
    );
    expect(markup).toMatch(/^<section aria-labelledby="home-start-heading" class="dark /);
    expect(markup).toMatch(/text-center/);
    expect(markup).toMatch(/<h2 id="home-start-heading"[^>]*>Your Workforce. Your Network. One Platform.<\/h2>/);
    expect(markup.indexOf("Join Chara Pinnacle")).toBeLessThan(markup.indexOf("Start hiring"));
    expect(/<a [^>]*href="\/en\/signup\?kind=company"[^>]*>Start hiring<\/a>/.exec(markup)?.[0]).toContain("bg-transparent");
  });

  it("leaves out an action that is not offered, and the buttons altogether when there is none", () => {
    const one = html(<ClosingCall id="x" title="Ready to hire?" primary={{ href: "/en/post-job", label: "Post a job" }} secondary={null} />);
    expect(one.match(/<a /g)).toHaveLength(1);
    const none = html(<ClosingCall id="x" title="Ready to hire?" primary={null} />);
    expect(none).not.toContain("<a ");
    expect(none).toContain("Ready to hire?");
  });
});

describe("every section of the home page", () => {
  it("says nothing of a later phase and none of the claims the audits removed", () => {
    for (const markup of sections()) {
      for (const phrase of NEVER_SAID) expect(textOf(markup), phrase).not.toContain(phrase);
    }
  });

  it("holds no photograph, no style attribute, no gradient and no arbitrary shadow, radius or size", () => {
    for (const markup of sections()) {
      expect(markup).not.toMatch(/<(img|picture|svg)\b(?![^>]*aria-hidden)/);
      expect(markup).not.toMatch(/\sstyle=/);
      // The autofill shadow is part of every text control (control-class.ts), not a look of the page.
      expect(markup).not.toMatch(/gradient|(?<!autofill:)shadow-\[|rounded-\[|text-\[|rounded-3xl/);
    }
  });

  it("sets the sections on hairlines in the page column, not on coloured bands", () => {
    const band = html(<Band aria-labelledby="x">x</Band>);
    expect(band).toMatch(/^<section class="border-t" aria-labelledby="x"><div class="mx-auto w-full max-w-6xl px-4 sm:px-6 py-20 sm:py-28 lg:py-32">/);
    expect(band).not.toMatch(/\bdark\b/);
  });
});

describe("the footer", () => {
  it("has three named columns of links, the first title being a paragraph, not a heading, and For employers in Platform", () => {
    const markup = html(<FooterColumns lang="en" />);
    expect(markup.startsWith('<nav aria-label="Footer"')).toBe(true);
    expect(markup).not.toMatch(/<h[1-6]/);
    expect([...markup.matchAll(/<ul aria-labelledby="(footer-[a-z]+)"/g)].map(([, id]) => id)).toEqual([
      "footer-platform",
      "footer-company",
      "footer-legal",
    ]);
    const platform = /<ul aria-labelledby="footer-platform">(.*?)<\/ul>/.exec(markup)?.[1] ?? "";
    expect([...platform.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map(([, label]) => label)).toEqual(["Find jobs", "For employers", "How Chara Pinnacle works"]);
    expect(markup).toContain('href="/en/employers"');
    expect(markup).toContain('href="/en/legal"');
  });

  it("keeps the logo and the copyright line when a page gives it no links", () => {
    const markup = html(<SiteFooter />);
    expect(markup).toContain("Chara Pinnacle");
    expect(markup).toContain(`© ${new Date().getFullYear()} Chara Pinnacle`);
    expect(textOf(markup)).toContain("City names from GeoNames , CC BY 4.0");
    expect(markup).toContain('<a href="https://www.geonames.org"');
    expect(markup).not.toContain("<nav");
  });
});
