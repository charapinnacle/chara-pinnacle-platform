import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Band } from "@/components/home/band";
import { Browse } from "@/components/home/browse";
import { ClosingCall } from "@/components/home/closing-call";
import { Hero } from "@/components/home/hero";
import { LatestJobs } from "@/components/home/latest-jobs";
import { PassportPreview } from "@/components/home/passport-preview";
import { Photo } from "@/components/home/photo";
import { PipelinePreview } from "@/components/home/pipeline-preview";
import { ProductPanels } from "@/components/home/product-panels";
import { ReachBand } from "@/components/home/reach-band";
import { TrustStrip } from "@/components/home/trust-strip";
import { FooterColumns } from "@/components/layout/footer-links";
import { SiteFooter } from "@/components/layout/site-footer";
import type { JobSearchResult } from "@/lib/dal/hiring";

const html = renderToStaticMarkup;
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

const popular = [
  { code: "7212", label: "Welder" },
  { code: "8332", label: "Truck driver" },
];

function job(index: number, overrides: Partial<JobSearchResult> = {}): JobSearchResult {
  return {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    title: `Welder number ${index}`,
    employerName: `Employer ${index}`,
    countryCode: "DE",
    city: "Hamburg",
    employmentType: "full_time",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    accommodation: false,
    visaSupport: false,
    createdAt: "2026-10-03T08:00:00.000Z",
    ...overrides,
  };
}

const countryNames = new Map([["DE", "Germany"]]);

describe("the hero", () => {
  const markup = html(<Hero lang="en" popular={popular} />);

  it("marks itself for the header and holds the one h1, the client's line, the search and the way to post a job", () => {
    expect(markup).toMatch(/^<header data-hero="true" class="dark /);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(textOf(markup)).toContain("The Global Workforce Network");
    expect(textOf(markup)).toContain("Connect with the people and companies that can build your workforce.");
    expect(markup).toContain('role="search"');
    expect(markup).toMatch(/Hiring\?.*<a [^>]*href="\/en\/signup\?kind=company"[^>]*>Post a Job<\/a>/);
  });

  it("lists the popular searches as links to Find Jobs filtered by their occupation, in order", () => {
    const links = [...markup.matchAll(/<a [^>]*href="(\/en\/jobs\?occupation=\d{4})"[^>]*>([^<]+)<\/a>/g)].map(([, href, label]) => [href, label]);
    expect(links).toEqual([
      ["/en/jobs?occupation=7212", "Welder"],
      ["/en/jobs?occupation=8332", "Truck driver"],
    ]);
    expect(markup).toMatch(/<ul aria-labelledby="popular-searches"/);
  });

  it("leaves out the row of popular searches when no occupation is known", () => {
    expect(html(<Hero lang="en" popular={[]} />)).not.toContain("Popular searches");
  });

  it("puts the welding photograph under the text as the one eager, high-priority picture, and writes no style attribute", () => {
    expect(markup.match(/<img/g)).toHaveLength(1);
    expect(markup).toMatch(/<source type="image\/webp" srcSet="\/images\/home\/hero-welder-640\.webp 640w, [^"]*hero-welder-2400\.webp 2400w" sizes="100vw"/);
    expect(markup).toMatch(/<img [^>]*loading="eager"[^>]*fetchPriority="high"/);
    expect(markup).not.toMatch(/\sstyle=/);
  });
});

describe("a photograph", () => {
  it("is a picture with a WebP and a JPEG set, its size given (no layout shift), an empty alt, and lazy unless it is the priority", () => {
    const markup = html(<Photo name="hospitality-chef" sizes="50vw" />);
    expect(markup).toMatch(/^<picture class="absolute inset-0 -z-20"><source type="image\/webp" srcSet="[^"]+-640\.webp 640w, [^"]+-1280\.webp 1280w, [^"]+-1920\.webp 1920w" sizes="50vw"\/>/);
    expect(markup).toContain('src="/images/home/hospitality-chef-1280.jpg"');
    expect(markup).toContain('srcSet="/images/home/hospitality-chef-640.jpg 640w, /images/home/hospitality-chef-1280.jpg 1280w, /images/home/hospitality-chef-1920.jpg 1920w"');
    expect(markup).toMatch(/width="1920" height="1280" alt=""/);
    expect(markup).toContain('loading="lazy"');
    expect(markup).not.toContain("fetchPriority");
  });
});

describe("the latest jobs", () => {
  it("shows up to six vacancies as cards, each one link to its vacancy page named by its title, with the place, the salary when given and the date", () => {
    const jobs = Array.from({ length: 8 }, (_, index) =>
      job(index, index === 0 ? { salaryMin: 3200, salaryMax: 3900, salaryCurrency: "EUR", salaryPeriod: "month" } : {}),
    );
    const markup = html(<LatestJobs lang="en" jobs={jobs} countryNames={countryNames} />);
    const cards = (markup.match(/<a [^>]*aria-labelledby="[^"]+"[^>]*>/g) ?? []).map((tag) => ({
      href: /href="([^"]+)"/.exec(tag)?.[1],
      labelledBy: /aria-labelledby="([^"]+)"/.exec(tag)?.[1],
    }));
    expect(cards.map(({ href }) => href)).toEqual(jobs.slice(0, 6).map(({ id }) => `/en/jobs/${id}`));
    expect(cards.map(({ labelledBy }) => labelledBy)).toEqual(jobs.slice(0, 6).map(({ id }) => `home-job-${id}`));
    expect(markup).toMatch(/<h3 id="home-job-[^"]+0"[^>]*>Welder number 0<\/h3>/);
    expect(textOf(markup)).toContain("Hamburg, Germany");
    expect(textOf(markup)).toContain("EUR 3,200 to 3,900, per month");
    expect(markup).toContain('Posted <time dateTime="2026-10-03T08:00:00.000Z">3 Oct 2026</time>');
    expect(markup.match(/Apply now/g)).toHaveLength(6);
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*>Apply now<\/span>/);
    expect(markup).toMatch(/<a [^>]*href="\/en\/jobs"[^>]*>Browse all jobs<\/a>/);
    expect(markup).not.toContain("Welder number 6");
  });

  it("with fewer than three vacancies shows a calm empty state with Post a Job instead of a short list", () => {
    for (const jobs of [[], [job(1), job(2)]]) {
      const markup = html(<LatestJobs lang="en" jobs={jobs} countryNames={countryNames} />);
      expect(markup).not.toMatch(/href="\/en\/jobs\/0/);
      expect(textOf(markup)).toContain("The first vacancies are on their way");
      expect(markup).toMatch(/<a [^>]*href="\/en\/signup\?kind=company"[^>]*>Post a Job<\/a>/);
      expect(markup).toMatch(/>Browse all jobs<\/a>/);
    }
  });
});

describe("browse by industry and by country", () => {
  const countries = [
    { code: "DE", name: "Germany" },
    { code: "PL", name: "Poland" },
  ];

  it("has six photo tiles that open Find Jobs filtered by their industry, with a count only from the credible minimum", () => {
    const markup = html(<Browse lang="en" industryCounts={{ F: 100, Q: 99, H: 0 }} countries={countries} />);
    const tiles = [...markup.matchAll(/<a [^>]*href="\/en\/jobs\?industry=([A-Z])"/g)].map(([, code]) => code);
    expect(tiles).toEqual(["F", "Q", "H", "I", "C", "G"]);
    expect(markup.match(/<img/g)).toHaveLength(6);
    expect(markup.match(/loading="lazy"/g)).toHaveLength(6);
    expect(textOf(markup)).toContain("Construction 100 open jobs");
    expect(textOf(markup)).not.toMatch(/\b99\b|\b0 open jobs/);
    expect(markup.match(/open jobs/g)).toHaveLength(1);
  });

  it("shows no count at all when the counts could not be read", () => {
    expect(html(<Browse lang="en" industryCounts={null} countries={countries} />)).not.toContain("open jobs");
  });

  it("lists the countries with open vacancies as links to their filter, then All countries", () => {
    const markup = html(<Browse lang="en" industryCounts={null} countries={countries} />);
    const chips = [...markup.matchAll(/<a [^>]*href="(\/en\/jobs(?:\?country=[A-Z]{2})?)"[^>]*>([^<]+)<\/a>/g)].map(([, href, label]) => [href, label]);
    expect(chips).toEqual([
      ["/en/jobs?country=DE", "Germany"],
      ["/en/jobs?country=PL", "Poland"],
      ["/en/jobs", "All countries"],
    ]);
  });

  it("leaves out the countries when no vacancy is open", () => {
    const markup = html(<Browse lang="en" industryCounts={null} countries={[]} />);
    expect(markup).not.toContain("Browse by country");
    expect(markup).toContain("Browse by industry");
  });
});

describe("the product panels", () => {
  const markup = html(<ProductPanels lang="en" />);

  it("offer employers Post a Job and workers the passport, each beside a rendering of its screen", () => {
    expect(markup).toMatch(/<h2 id="home-employers-heading"[^>]*>Publish a vacancy and manage every applicant in one pipeline<\/h2>/);
    expect(markup).toMatch(/<h2 id="home-workers-heading"[^>]*>One CHARA Passport for every application<\/h2>/);
    expect(markup).toMatch(/<a [^>]*href="\/en\/signup\?kind=company"[^>]*>Post a Job<\/a>/);
    expect(markup).toMatch(/<a [^>]*href="\/en\/signup\?kind=worker"[^>]*>Create your passport<\/a>/);
    expect(markup).toContain("employers-handshake-640.webp");
  });

  it("promise nothing of a later phase", () => {
    for (const later of ["match", "Match", "corridor", "verified", "Verified", "message", "recruitment", "staffing"]) expect(textOf(markup)).not.toContain(later);
  });
});

describe("the renderings of the product", () => {
  for (const [name, preview] of [
    ["pipeline", <PipelinePreview key="pipeline" />],
    ["passport", <PassportPreview key="passport" />],
  ] as const) {
    it(`of the ${name} are hidden from assistive technology, hold no link and say that their data is fictional`, () => {
      const markup = html(preview);
      expect(markup).toMatch(/^<div aria-hidden="true"/);
      expect(markup).not.toContain("<a ");
      expect(markup).toContain("Illustration with fictional data");
    });
  }

  it("of the pipeline draw the stages of the real board with their labels", () => {
    const stages = [...html(<PipelinePreview />).matchAll(/<p class="flex items-center justify-between[^"]*">([A-Za-z ]+)<span/g)].map(([, label]) => label);
    expect(stages).toEqual(["Applied", "Shortlisted", "Interview"]);
  });
});

describe("the reach band", () => {
  const figures = [
    { label: "Countries and territories", value: "250" },
    { label: "Languages", value: "184" },
  ];

  it("lists the reference figures as a list, so that the page has a description list only with live statistics", () => {
    const markup = html(<ReachBand figures={figures} tiles={[]} />);
    expect(markup).toMatch(/<li[^>]*><span[^>]*>Countries and territories<\/span><span[^>]*>250<\/span><\/li>/);
    expect(markup).not.toContain("<dl");
    expect(markup).not.toContain("platform-statistics-heading");
  });

  it("adds the live statistics under their own heading when there is a tile", () => {
    const markup = html(<ReachBand figures={figures} tiles={[{ label: "Active jobs", value: "150" }]} />);
    expect(markup).toMatch(/<h2 id="platform-statistics-heading"[^>]*>Global Workforce Network<\/h2>/);
    expect(markup).toMatch(/<dt[^>]*>Active jobs<\/dt><dd[^>]*>150<\/dd>/);
  });
});

describe("the trust strip", () => {
  it("says five short things that the product does today, as a list without headings, and links to Trust & Safety", () => {
    const markup = html(<TrustStrip lang="en" />);
    expect([...markup.matchAll(/<span class="text-small[^"]*">([^<]+)<\/span>/g)].map(([, text]) => text)).toEqual([
      "Workers never pay",
      "Documents private by default",
      "Data stored in the EU",
      "Two-step verification for employer admins",
      "Vacancies are moderated",
    ]);
    expect(markup.match(/<svg/g)).toHaveLength(5);
    expect(markup).not.toMatch(/<h[1-6]/);
    expect(markup).toMatch(/<a [^>]*href="\/en\/trust-safety"[^>]*>Trust &amp; Safety<\/a>/);
  });
});

describe("the closing call", () => {
  it("sets the client's line over the lazy construction photograph with Join and Post a Job", () => {
    const markup = html(<ClosingCall lang="en" />);
    expect(markup).toMatch(/<h2 id="home-start-heading"[^>]*>Your Workforce. Your Network. One Platform.<\/h2>/);
    expect(markup).toContain("construction-team-1280.jpg");
    expect(markup).toContain('loading="lazy"');
    expect(markup).toMatch(/<a [^>]*href="\/en\/signup\?kind=worker"[^>]*>Join Chara Pinnacle<\/a>/);
    expect(markup).toMatch(/<a [^>]*href="\/en\/signup\?kind=company"[^>]*>Post a Job<\/a>/);
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
  it("has three named columns of links, the first title being a paragraph, not a heading, and the photo credits in Legal", () => {
    const markup = html(<FooterColumns lang="en" />);
    expect(markup.startsWith('<nav aria-label="Footer"')).toBe(true);
    expect(markup).not.toMatch(/<h[1-6]/);
    expect([...markup.matchAll(/<ul aria-labelledby="(footer-[a-z]+)"/g)].map(([, id]) => id)).toEqual([
      "footer-platform",
      "footer-company",
      "footer-legal",
    ]);
    expect(markup).toMatch(/<a [^>]*href="\/en\/imprint#photo-credits"[^>]*>Photo credits<\/a>/);
    expect(markup).toContain('href="/en/legal"');
  });

  it("keeps the logo and the copyright line when a page gives it no links", () => {
    const markup = html(<SiteFooter />);
    expect(markup).toContain("Chara Pinnacle");
    expect(markup).toContain(`© ${new Date().getFullYear()} Chara Pinnacle`);
    expect(markup).not.toContain("<nav");
  });
});
