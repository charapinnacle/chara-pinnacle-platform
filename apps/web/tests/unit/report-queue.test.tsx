import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/admin-reports", () => ({ listReports: listMock }));

const { ReportQueue } = await import("@/components/admin/report-queue");

const row = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  reference: `R-${String(id).padStart(6, "0")}`,
  targetType: "partner_profile",
  targetLabel: "Manila Skills",
  category: "fee_demanded_from_worker",
  status: "new",
  priority: 1,
  dueAt: "2026-10-06T08:00:00+00:00",
  overdue: true,
  createdAt: "2026-10-05T08:00:00+00:00",
  handledAt: null,
  ...over,
});

async function render(next: unknown = null) {
  listMock.mockResolvedValue({
    rows: [row(7), row(3, { category: "harassment", priority: 2, overdue: false, targetType: "job", targetLabel: "Welder" })],
    next,
  });
  return renderToStaticMarkup(await ReportQueue({ lang: "en", filter: { status: "open" }, after: null }));
}

describe("the report queue (FR-S1 AC3, AC10)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("labels a fee demand, shows each row's due time and flags the overdue one", async () => {
    const html = await render();
    expect(html.match(/Fee demand/g)).toHaveLength(1);
    expect(html.match(/Overdue/g)).toHaveLength(1);
    expect(html).toContain(">Due<");
    expect(html).toContain('dateTime="2026-10-06T08:00:00+00:00"');
    expect(html).toContain("Partner profile: </span>Manila Skills");
    expect(html.indexOf("R-000007")).toBeLessThan(html.indexOf("R-000003"));
  });

  it("shows no due time and no overdue flag for a closed report", async () => {
    listMock.mockResolvedValue({
      rows: [row(9, { status: "dismissed", overdue: false, dueAt: "2026-10-01T08:00:00+00:00" })],
      next: null,
    });
    const html = renderToStaticMarkup(await ReportQueue({ lang: "en", filter: { status: "dismissed" }, after: null }));
    expect(html).toContain("R-000009");
    expect(html).not.toContain('dateTime="2026-10-01T08:00:00+00:00"');
    expect(html).not.toContain("Overdue");
  });

  it("FR-S1 AC11: says No open reports for an empty queue, and that nothing matches for an empty filtered list", async () => {
    listMock.mockResolvedValue({ rows: [], next: null });
    expect(renderToStaticMarkup(await ReportQueue({ lang: "en", filter: { status: "open" }, after: null }))).toContain("No open reports");
    const filtered = renderToStaticMarkup(await ReportQueue({ lang: "en", filter: { status: "open", type: "job" }, after: null }));
    expect(filtered).toContain("No reports here");
    expect(filtered).not.toContain("No open reports");
  });

  it("links the next page with the whole cursor of the last row", async () => {
    const html = await render({ priority: 2, dueAt: "2026-10-07T08:00:00+00:00", id: 3 });
    expect(html).toContain(`href="/en/admin/reports?status=open&amp;after=${encodeURIComponent("2_2026-10-07T08:00:00+00:00_3")}"`);
  });
});
