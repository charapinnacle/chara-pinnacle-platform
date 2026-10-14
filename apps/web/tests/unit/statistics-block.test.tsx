import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatisticsBlock } from "@/components/home/statistics-block";

const getPlatformStatistics = vi.hoisted(() => vi.fn());
const getPostJobHref = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/statistics", () => ({ getPlatformStatistics }));
vi.mock("@/lib/dal/organizations", () => ({ getPostJobHref }));

const { default: Home } = await import("@/app/[lang]/(public)/page");

async function renderHome(): Promise<string> {
  const { prelude } = await prerender(<Home params={Promise.resolve({ lang: "en" })} searchParams={Promise.resolve({})} />);
  return new Response(prelude).text();
}

const textOf = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

beforeEach(() => {
  getPlatformStatistics.mockResolvedValue([]);
  getPostJobHref.mockResolvedValue("/en/signup?kind=company");
});

describe("the statistics block (FR-H4 AC1, AC3, AC4)", () => {
  it("puts each label and its value in the same group of a description list", () => {
    const html = renderToStaticMarkup(
      <StatisticsBlock tiles={[{ label: "Workers", value: "1,230" }, { label: "Active jobs", value: "150" }]} />,
    );
    expect(html).toMatch(/<h2 id="platform-statistics-heading"[^>]*>Global Workforce Network<\/h2>/);
    expect(html).toMatch(/<div[^>]*><dt[^>]*>Active jobs<\/dt><dd[^>]*>150<\/dd><\/div>/);
    expect(html).toMatch(/<div[^>]*><dt[^>]*>Workers<\/dt><dd[^>]*>1,230<\/dd><\/div>/);
    expect(html).not.toContain("Employers");
  });

  it("is on the home page, after the passport and before the closing call, when there is a tile", async () => {
    getPlatformStatistics.mockResolvedValue([{ label: "Active jobs", value: "150" }]);
    const html = await renderHome();
    expect(html).toContain("<dd");
    expect(html.indexOf("home-passport-heading")).toBeLessThan(html.indexOf("platform-statistics-heading"));
    expect(html.indexOf("platform-statistics-heading")).toBeLessThan(html.indexOf("home-start-heading"));
  });

  it("leaves the block out of the home page, with no heading and no empty place, when there is no tile", async () => {
    const html = await renderHome();
    expect(textOf(html)).toContain("The Global Workforce Network");
    expect(html).toContain("Your Workforce. Your Network. One Platform.");
    expect(html).not.toContain("platform-statistics-heading");
    expect(html).not.toContain("<dl");
  });
});

describe("the home page (U71)", () => {
  it("follows the client's order within Phase 1: hero, Who are you?, the network, the CHARA Passport, the closing call", async () => {
    const html = await renderHome();
    const order = ['<h1 id="home-heading"', "home-who-heading", "home-network-heading", "home-passport-heading", "home-start-heading"].map((marker) =>
      html.indexOf(marker),
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("reads no vacancy and shows no photograph: the search is the way to the vacancies", async () => {
    const html = await renderHome();
    expect(html).not.toMatch(/<(img|picture)\b/);
    expect(html).not.toMatch(/rel="preload" as="image"/);
    expect(html).not.toMatch(/href="\/en\/jobs\/[0-9a-f-]{36}"/);
    expect(html).not.toContain("/images/");
  });

  it("leads every Post a Job of the page where the header's does, and offers none to whom the header offers none", async () => {
    getPostJobHref.mockResolvedValue("/en/post-job");
    const employer = await renderHome();
    expect(employer.match(/href="\/en\/post-job"/g)).toHaveLength(2);
    getPostJobHref.mockResolvedValue(null);
    const candidate = await renderHome();
    expect(candidate).not.toContain("Post a Job");
    expect(candidate).not.toContain("Start hiring");
    expect(candidate).toContain('role="search"');
  });

  it("writes no style attribute, which the page's policy would block", async () => {
    expect(await renderHome()).not.toMatch(/<[^>]+\sstyle=/);
  });
});
