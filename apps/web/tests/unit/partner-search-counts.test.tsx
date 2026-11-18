import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const countsMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/admin", () => ({ partnerSearchCounts: countsMock }));

const { PartnerSearchCounts } = await import("@/components/admin/partner-search-counts");

async function render() {
  return renderToStaticMarkup(await PartnerSearchCounts({ kind: "recruitment", from: "2026-10-01", to: "2026-10-31" }));
}

beforeEach(() => {
  countsMock.mockReset();
});

describe("PartnerSearchCounts (FR-L1 KPIs, FR-S2 AC9)", () => {
  it("shows the counts from the threshold on, with their shares, and the days in the shared date format", async () => {
    countsMock.mockResolvedValue({
      searches: 40,
      withResults: 30,
      zeroResults: 10,
      zeroByDestination: [{ code: "NO", name: "Norway", searches: 6 }],
      minCount: 5,
    });
    const html = await render();
    expect(html).toContain('aria-label="Recruitment partner searches from 1 October 2026 to 31 October 2026"');
    expect(html).toContain(">30</td><td class=\"px-3 py-3 align-top\">75 %</td>");
    expect(html).toContain(">Norway</td><td class=\"px-3 py-3 align-top\">6</td>");
    expect(html).not.toContain("2026-10-01");
  });

  it("says fewer than the threshold for a hidden count, with no share, and no destination below it", async () => {
    countsMock.mockResolvedValue({ searches: 7, withResults: null, zeroResults: null, zeroByDestination: [], minCount: 5 });
    const html = await render();
    expect(html.match(/fewer than 5/g)).toHaveLength(2);
    expect(html).toContain(">7</td>");
    expect(html).not.toMatch(/>[1-4]<\/td>/);
    expect(html).toContain("No destination has 5 or more searches without results.");
  });
});
