import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyReportsList } from "@/components/reports/my-reports-list";
import type { MyReport } from "@/lib/dal/reports";

const listMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/reports", () => ({ listMyReports: listMock }));

const { ReportOutcomes } = await import("@/components/reports/report-outcomes");

const report = (over: Partial<MyReport> = {}): MyReport => ({
  id: 1,
  reference: "R-000001",
  targetType: "job",
  targetLabel: "Welder <b>MIG</b>",
  category: "misleading_or_fraud",
  status: "new",
  resolutionNote: null,
  handledAt: null,
  createdAt: "2026-10-01T10:00:00+00:00",
  ...over,
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe("MyReportsList", () => {
  it("shows the reference, the target, the category and the status in words, and escapes the title", () => {
    const html = renderToStaticMarkup(<MyReportsList reports={[report()]} />);
    expect(html).toContain("R-000001");
    expect(html).toContain("Vacancy: ");
    expect(html).toContain("Welder &lt;b&gt;MIG&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain("Misleading or fraudulent");
    expect(html).toContain("New");
    expect(html).not.toContain("Note from Trust");
  });

  it("shows the outcome and the note of a closed report", () => {
    const html = renderToStaticMarkup(
      <MyReportsList reports={[report({ status: "actioned", resolutionNote: "The vacancy was hidden.\nThank you.", handledAt: "2026-10-05T10:00:00+00:00" })]} />,
    );
    expect(html).toContain("Actioned");
    expect(html).toContain("Note from Trust &amp; Safety on 5 October 2026");
    expect(html).toContain("The vacancy was hidden.\nThank you.");
  });
});

describe("ReportOutcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  const render = async () => {
    const element = await ReportOutcomes({ lang: "en" });
    return element ? renderToStaticMarkup(element) : "";
  };

  it("tells the reporter about a report closed in the last 14 days, with the outcome and the note, and links to the list", async () => {
    listMock.mockResolvedValue({
      reports: [
        report({ id: 2, reference: "R-000002", status: "dismissed", resolutionNote: "Nothing in it breaks the rules.", handledAt: daysAgo(3) }),
        report({ id: 3, reference: "R-000003", status: "actioned", resolutionNote: "Old news.", handledAt: daysAgo(20) }),
        report({ id: 4, reference: "R-000004", status: "new" }),
      ],
      next: null,
    });
    const html = await render();
    expect(html).toContain("R-000002");
    expect(html).toContain("was closed as <strong>dismissed</strong>");
    expect(html).toContain("Nothing in it breaks the rules.");
    expect(html).toContain('href="/en/reports"');
    expect(html).not.toContain("R-000003");
    expect(html).not.toContain("R-000004");
  });

  it("shows nothing when no report was closed lately, and nothing when the reports cannot be read", async () => {
    listMock.mockResolvedValue({ reports: [report()], next: null });
    expect(await render()).toBe("");
    listMock.mockRejectedValue(new Error("The reports could not be loaded"));
    expect(await render()).toBe("");
    expect(console.error).toHaveBeenCalledOnce();
  });
});
