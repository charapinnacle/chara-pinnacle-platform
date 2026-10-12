import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatisticsBlock } from "@/components/home/statistics-block";

const getPlatformStatistics = vi.hoisted(() => vi.fn());
const getNewestJobs = vi.hoisted(() => vi.fn());
const getIndustryCounts = vi.hoisted(() => vi.fn());
const getHomeReference = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/display-font", () => ({ newsreader: { variable: "font-newsreader" } }));
vi.mock("@/lib/dal/statistics", () => ({ getPlatformStatistics }));
vi.mock("@/lib/dal/home", () => ({ getNewestJobs, getIndustryCounts, getHomeReference }));

const reference = {
  countries: [
    { code: "DE", name: "Germany" },
    { code: "PL", name: "Poland" },
    { code: "NL", name: "Netherlands" },
  ],
  industries: [{ code: "F", name: "Construction" }],
  languages: [
    { code: "en", name: "English" },
    { code: "pl", name: "Polish" },
  ],
  occupations: [
    { code: "7212", label: "Welders and flame cutters", synonyms: ["welder"] },
    { code: "8332", label: "Heavy truck and lorry drivers", synonyms: ["truck driver"] },
    { code: "9999", label: "Not popular", synonyms: [] },
  ],
};

const { default: Home } = await import("@/app/[lang]/(public)/page");

async function renderHome(): Promise<string> {
  const { prelude } = await prerender(<Home params={Promise.resolve({ lang: "en" })} searchParams={Promise.resolve({})} />);
  return new Response(prelude).text();
}

const textOf = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

const vacancy = (id: number, countryCode: string) => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  title: `Vacancy ${id}`,
  employerName: "Employer",
  countryCode,
  city: "City",
  employmentType: "full_time",
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  accommodation: false,
  visaSupport: false,
  createdAt: "2026-10-03T08:00:00.000Z",
});

beforeEach(() => {
  getPlatformStatistics.mockResolvedValue([]);
  getNewestJobs.mockResolvedValue([vacancy(1, "PL"), vacancy(2, "DE"), vacancy(3, "PL")]);
  getIndustryCounts.mockResolvedValue({ F: 0 });
  getHomeReference.mockResolvedValue(reference);
});

describe("the statistics block (FR-H4 AC1, AC3, AC4)", () => {
  it("puts each label and its value in the same group of a description list", () => {
    const html = renderToStaticMarkup(
      <StatisticsBlock tiles={[{ label: "Workers", value: "1,230" }, { label: "Active jobs", value: "150" }]} />,
    );
    expect(html).toContain("Global Workforce Network");
    expect(html).toContain("<dt");
    expect(html).toMatch(/<div[^>]*><dt[^>]*>Active jobs<\/dt><dd[^>]*>150<\/dd><\/div>/);
    expect(html).toMatch(/<div[^>]*><dt[^>]*>Workers<\/dt><dd[^>]*>1,230<\/dd><\/div>/);
    expect(html).not.toContain("Employers");
  });

  it("is on the home page when there is a tile", async () => {
    getPlatformStatistics.mockResolvedValue([{ label: "Active jobs", value: "150" }]);
    const html = await renderHome();
    expect(textOf(html)).toContain("The Global Workforce Network");
    expect(html).toContain('id="platform-statistics-heading"');
    expect(html).toContain("<dd");
  });

  it("leaves the block out of the home page, with no heading and no empty place, when there is no tile", async () => {
    const html = await renderHome();
    expect(textOf(html)).toContain("The Global Workforce Network");
    expect(html).toContain("Your Workforce. Your Network. One Platform.");
    expect(html).not.toContain("platform-statistics-heading");
    expect(html).not.toContain("<dl");
  });
});

describe("the home page (U70)", () => {
  it("follows the product order: hero, latest jobs, industries, countries, the two panels, reach, trust, closing call", async () => {
    const html = await renderHome();
    const order = ["<h1", "home-jobs-heading", "home-industries-heading", "home-countries-heading", "home-employers-heading", "home-workers-heading", "home-reach-heading", "What you can rely on", "home-start-heading"].map((marker) => html.indexOf(marker));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("builds the popular searches from the occupations that exist, the chips from the countries of the open vacancies and the reach from the reference data", async () => {
    const html = await renderHome();
    expect([...html.matchAll(/href="\/en\/jobs\?occupation=(\d{4})"/g)].map(([, code]) => code)).toEqual(["7212", "8332"]);
    expect([...html.matchAll(/href="\/en\/jobs\?country=([A-Z]{2})"[^>]*>([^<]+)</g)].map(([, code, name]) => `${code} ${name}`)).toEqual(["PL Poland", "DE Germany"]);
    for (const [label, value] of [
      ["Countries and territories", "3"],
      ["Occupations (ISCO-08)", "3"],
      ["Industries (ISIC Rev.4)", "1"],
      ["Languages", "2"],
    ]) {
      expect(html).toMatch(new RegExp(`<span[^>]*>${label.replace(/[()]/g, "\\$&")}</span><span[^>]*>${value}</span>`));
    }
    expect(getIndustryCounts).toHaveBeenCalledWith(["F", "Q", "H", "I", "C", "G"]);
  });

  it("serves the rest of the page without the vacancy sections when the vacancies cannot be read", async () => {
    getNewestJobs.mockResolvedValue(null);
    getIndustryCounts.mockResolvedValue(null);
    const html = await renderHome();
    expect(html).not.toContain("home-jobs-heading");
    expect(html).not.toContain("home-countries-heading");
    expect(html).toContain("Browse by industry");
    expect(html).toContain("Your Workforce. Your Network. One Platform.");
  });

  it("serves the hero, the search and the closing call without the popular searches, the country chips and the reach band when the reference data cannot be read", async () => {
    getHomeReference.mockResolvedValue(null);
    getPlatformStatistics.mockResolvedValue([{ label: "Active jobs", value: "150" }]);
    const html = await renderHome();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(textOf(html)).toContain("The Global Workforce Network");
    expect(html).toContain('role="search"');
    expect(html).toContain("Your Workforce. Your Network. One Platform.");
    expect(html).not.toContain("Popular searches");
    expect(html).not.toContain("home-countries-heading");
    expect(html).not.toContain("home-reach-heading");
    expect(html).toContain("home-jobs-heading");
    expect(textOf(html)).toContain("City , PL");
  });

  it("preloads the hero photograph with the sources and sizes of its picture, before the page", async () => {
    const html = await renderHome();
    const link = /<link rel="preload" as="image"[^>]*>/.exec(html)?.[0] ?? "";
    expect(link).toContain('type="image/webp"');
    expect(link).toContain('fetchPriority="high"');
    expect(link).toContain('imageSizes="100vw"');
    expect(link).toMatch(/imageSrcSet="\/images\/home\/hero-welder-640\.webp 640w, [^"]+hero-welder-2400\.webp 2400w"/);
    expect(html.indexOf(link)).toBeLessThan(html.indexOf("<header data-hero"));
    expect(html.match(/rel="preload" as="image"/g)).toHaveLength(1);
  });

  it("writes no style attribute, which the page's policy would block", async () => {
    expect(await renderHome()).not.toMatch(/<[^>]+\sstyle=/);
  });
});
