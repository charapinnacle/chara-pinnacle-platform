import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Band } from "@/components/home/band";
import { Hero } from "@/components/home/hero";
import { JourneyPreview } from "@/components/home/journey-preview";
import { PassportPreview } from "@/components/home/passport-preview";
import { TrustStrip } from "@/components/home/trust-strip";
import { FooterColumns } from "@/components/layout/footer-links";
import { SiteFooter } from "@/components/layout/site-footer";

const html = renderToStaticMarkup;

describe("the hero", () => {
  const markup = html(<Hero lang="en" />);

  it("marks itself for the header, holds the one h1 with the gold gradient on one word, the search and Post a Job", () => {
    expect(markup).toMatch(/^<header data-hero="true" class="dark /);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup.match(/bg-brand-gradient/g)).toHaveLength(1);
    expect(markup).toContain('role="search"');
    expect(markup).toMatch(/<a [^>]*href="\/en\/signup\?kind=company"[^>]*>Post a Job<\/a>/);
  });

  it("carries no style attribute and no image, because the page's policy allows neither inline styles nor an external picture", () => {
    expect(markup).not.toMatch(/\sstyle=/);
    expect(markup).not.toMatch(/<img|url\(http/);
  });
});

describe("the journey preview", () => {
  const markup = html(<JourneyPreview />);

  it("is hidden from assistive technology and names the four stages in order with placeholder words only", () => {
    expect(markup).toMatch(/^<div aria-hidden="true"/);
    const labels = [...markup.matchAll(/<span class="text-body[^"]*">([^<]+)<\/span>/g)].map(([, label]) => label);
    expect(labels).toEqual(["Applied", "Viewed", "Shortlisted", "Interview"]);
    expect(markup).toContain("Your vacancy");
  });

  it("shows no number, no date and no link, so it cannot pass for real activity", () => {
    const text = markup.replace(/<[^>]*>/g, " ");
    expect(text).not.toMatch(/\d/);
    expect(markup).not.toContain("<a ");
  });

  it("marks exactly one stage as the current one", () => {
    expect(markup.match(/journey-current/g)).toHaveLength(1);
    expect(markup.match(/Current stage/g)).toHaveLength(1);
  });
});

describe("the passport preview", () => {
  const markup = html(<PassportPreview />);

  it("is hidden from assistive technology, names the fields and holds no value, no number and no link", () => {
    expect(markup).toMatch(/^<div aria-hidden="true"/);
    for (const field of ["Occupation", "Skills", "Languages", "Availability"]) expect(markup).toContain(field);
    expect(markup.replace(/<svg.*<\/svg>/, "").replace(/<[^>]*>/g, " ")).not.toMatch(/\d/);
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("<dl");
  });
});

describe("the trust strip", () => {
  it("says four short things that the product does today, as a list without headings", () => {
    const markup = html(<TrustStrip />);
    expect([...markup.matchAll(/<span class="text-body[^"]*">([^<]+)<\/span>/g)].map(([, text]) => text)).toEqual([
      "Workers never pay",
      "Documents private by default",
      "Data stored in the EU",
      "Two-step verification for employer admins",
    ]);
    expect(markup.match(/<svg/g)).toHaveLength(4);
    expect(markup).not.toMatch(/<h[1-6]/);
  });
});

describe("the bands", () => {
  it("make the dark ones a dark token scope, the light ones not, and put the content in a column that rises in", () => {
    const dark = html(<Band tone="dark">x</Band>);
    expect(dark).toMatch(/^<section class="[^"]*\bdark\b/);
    expect(dark).toContain("data-reveal");
    expect(html(<Band tone="light">x</Band>)).not.toMatch(/\bdark\b/);
  });
});

describe("the footer", () => {
  it("has three named columns of links, the first title being a paragraph, not a heading", () => {
    const markup = html(<FooterColumns lang="en" />);
    expect(markup.startsWith('<nav aria-label="Footer"')).toBe(true);
    expect(markup).not.toMatch(/<h[1-6]/);
    expect([...markup.matchAll(/<ul aria-labelledby="(footer-[a-z]+)"/g)].map(([, id]) => id)).toEqual([
      "footer-platform",
      "footer-company",
      "footer-legal",
    ]);
    expect(markup).toContain('href="/en/legal"');
  });

  it("keeps the logo and the copyright line when a page gives it no links", () => {
    const markup = html(<SiteFooter />);
    expect(markup).toContain("Chara Pinnacle");
    expect(markup).toContain(`© ${new Date().getFullYear()} Chara Pinnacle`);
    expect(markup).not.toContain("<nav");
  });
});
