import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatisticsBlock } from "@/components/home/statistics-block";

const getPlatformStatistics = vi.hoisted(() => vi.fn());
const getPostJobHref = vi.hoisted(() => vi.fn());
const getCurrentUser = vi.hoisted(() => vi.fn());
const releasedSwitches = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/statistics", () => ({ getPlatformStatistics }));
vi.mock("@/lib/dal/organizations", () => ({ getPostJobHref }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser }));
vi.mock("@/lib/dal/release", () => ({ releasedSwitches }));
vi.mock("@/lib/dal/hiring", () => ({ getSearchSuggestions: async () => ({ titles: ["Plumber"] }) }));
vi.mock("@/lib/dal/reference", () => ({
  getCountries: async () => [{ code: "DE", name: "Germany" }],
  getOccupations: async () => [{ code: "7126", label: "Plumbers and pipe fitters", synonyms: ["plumber"] }],
}));

const { default: Home } = await import("@/app/[lang]/(public)/page");

async function renderHome(): Promise<string> {
  const { prelude } = await prerender(<Home params={Promise.resolve({ lang: "en" })} searchParams={Promise.resolve({})} />);
  return new Response(prelude).text();
}

const textOf = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

beforeEach(() => {
  getPlatformStatistics.mockResolvedValue([]);
  getPostJobHref.mockResolvedValue("/en/signup?kind=company");
  getCurrentUser.mockResolvedValue(null);
  releasedSwitches.mockResolvedValue([]);
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

describe("the home page (U73)", () => {
  it("follows the order of D90: hero, How it works, the CHARA Passport, the employer band, the closing call, and no audience split", async () => {
    const html = await renderHome();
    const order = ['<h1 id="home-heading"', "home-how-heading", "home-passport-heading", 'aria-label="For employers"', "home-start-heading"].map((marker) =>
      html.indexOf(marker),
    );
    expect(html).not.toContain("home-who-heading");
    expect(html).not.toContain("home-network-heading");
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("reads no vacancy and shows no photograph: the search is the way to the vacancies", async () => {
    const html = await renderHome();
    expect(html).not.toMatch(/<(img|picture)\b/);
    expect(html).not.toMatch(/rel="preload" as="image"/);
    expect(html).not.toMatch(/href="\/en\/jobs\/[0-9a-f-]{36}"/);
    // Vacancy titles only feed the suggestions of the What field, which open while typing; no vacancy is listed.
    expect(html).not.toContain(">Plumber<");
    expect(html).not.toContain("/images/");
  });

  it("leads every Post a Job of the page where the header's does, and offers none to whom the header offers none", async () => {
    getPostJobHref.mockResolvedValue("/en/post-job");
    const employer = await renderHome();
    // The employer band's Post a Job and the closing call's Start hiring; the hero's line leads to For employers.
    expect(employer.match(/href="\/en\/post-job"/g)).toHaveLength(2);
    getPostJobHref.mockResolvedValue(null);
    const candidate = await renderHome();
    // Only the hero's quiet line remains, and it leads to For employers, not to posting.
    expect(candidate.match(/>Post a Job</g)).toHaveLength(1);
    expect(candidate).toContain('href="/en/employers">Post a Job</a>');
    expect(candidate).not.toContain("Start hiring");
    expect(candidate).toContain('role="search"');
  });

  it("writes no style attribute, which the page's policy would block", async () => {
    expect(await renderHome()).not.toMatch(/<[^>]+\sstyle=/);
  });
  it("shows a signed-in worker only the job seeker's side: no employer line, band or call to join", async () => {
    getCurrentUser.mockResolvedValue({ accountKind: "worker" });
    getPostJobHref.mockResolvedValue(null);
    const html = await renderHome();
    expect(html).toContain('role="search"');
    expect(html).toContain("home-how-heading");
    expect(html).toContain("home-passport-heading");
    expect(html).not.toContain("Hiring?");
    expect(html).not.toContain('aria-label="For employers"');
    expect(html).not.toContain('href="/en/employers"');
    expect(html).not.toContain("home-start-heading");
  });

  it("shows a signed-in company only the employer's side: no job seeker's steps, passport or call to join", async () => {
    getCurrentUser.mockResolvedValue({ accountKind: "company" });
    getPostJobHref.mockResolvedValue("/en/post-job");
    const html = await renderHome();
    expect(html).toContain('role="search"');
    expect(html).toContain('aria-label="For employers"');
    expect(html).toContain('href="/en/post-job"');
    expect(html).not.toContain("home-how-heading");
    expect(html).not.toContain("home-passport-heading");
    expect(html).not.toContain("home-start-heading");
    expect(html).not.toContain("Hiring? Post a Job");
  });
});

describe("the partner audience of the home page (FR-L5 AC9)", () => {
  it("is not on the page while release 2a is off", async () => {
    const html = await renderHome();
    expect(html).not.toContain("home-partners-heading");
    expect(textOf(html).toLowerCase()).not.toMatch(/recruitment|staffing/);
  });

  it("follows the employer band while release 2a is on, headed for recruitment and staffing companies, with the sign-up as either and both directories", async () => {
    releasedSwitches.mockResolvedValue(["release_partner_directories"]);
    const html = await renderHome();
    expect(html).toMatch(/<h2 id="home-partners-heading"[^>]*>For recruitment and staffing companies<\/h2>/);
    expect(html.indexOf('aria-label="For employers"')).toBeLessThan(html.indexOf("home-partners-heading"));
    expect(html.indexOf("home-partners-heading")).toBeLessThan(html.indexOf("home-start-heading"));
    for (const [href, label] of [
      ["/en/signup?kind=recruitment_company", "Sign up as a recruitment company"],
      ["/en/signup?kind=staffing_company", "Sign up as a staffing company"],
      ["/en/partners/recruitment", "Recruitment partners"],
      ["/en/partners/staffing", "Staffing partners"],
    ]) {
      expect(html).toMatch(new RegExp(`<a [^>]*href="${href.replace(/[?]/g, "\\?")}"[^>]*>${label}</a>`));
    }
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("offers a signed-in company the directories without a sign-up, and shows a worker nothing of it", async () => {
    releasedSwitches.mockResolvedValue(["release_partner_directories"]);
    getCurrentUser.mockResolvedValue({ accountKind: "company" });
    const company = await renderHome();
    expect(company).toContain("home-partners-heading");
    expect(company).toContain('href="/en/partners/recruitment"');
    expect(company).not.toContain("kind=recruitment_company");
    getCurrentUser.mockResolvedValue({ accountKind: "worker" });
    const worker = await renderHome();
    expect(worker).not.toContain("home-partners-heading");
    expect(worker).not.toContain("/en/partners/");
  });
});
