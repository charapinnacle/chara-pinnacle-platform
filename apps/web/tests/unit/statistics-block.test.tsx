import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";
import { StatisticsBlock } from "@/components/home/statistics-block";

const getPlatformStatistics = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/statistics", () => ({ getPlatformStatistics }));

const { default: Home } = await import("@/app/[lang]/(public)/page");

async function renderHome(): Promise<string> {
  const { prelude } = await prerender(<Home params={Promise.resolve({ lang: "en" })} searchParams={Promise.resolve({})} />);
  return new Response(prelude).text();
}

describe("the statistics block (FR-H4 AC1, AC3, AC4)", () => {
  it("puts each label and its value in the same group of a description list", () => {
    const html = renderToStaticMarkup(
      <StatisticsBlock tiles={[{ label: "Vacancies", value: "15" }, { label: "Candidates", value: "1,230" }]} />,
    );
    expect(html).toContain("CHARA in numbers");
    expect(html).toContain("<dt");
    expect(html).toMatch(/<div[^>]*><dt[^>]*>Vacancies<\/dt><dd[^>]*>15<\/dd><\/div>/);
    expect(html).toMatch(/<div[^>]*><dt[^>]*>Candidates<\/dt><dd[^>]*>1,230<\/dd><\/div>/);
    expect(html).not.toContain("Employers");
  });

  it("is on the home page when there is a tile", async () => {
    getPlatformStatistics.mockResolvedValue([{ label: "Vacancies", value: "15" }]);
    const html = await renderHome();
    expect(html).toContain("The Global Workforce Network");
    expect(html).toContain("CHARA in numbers");
    expect(html).toContain("<dd");
  });

  it("leaves the block out of the home page, with no heading and no empty place, when there is no tile", async () => {
    getPlatformStatistics.mockResolvedValue([]);
    const html = await renderHome();
    expect(html).toContain("The Global Workforce Network");
    expect(html).toContain("Your Workforce. Your Network. One Platform.");
    expect(html).not.toContain("CHARA in numbers");
    expect(html).not.toContain("<dl");
  });
});
