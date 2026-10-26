import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppealDetail } from "@/lib/dal/admin-appeals";

const getMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
const statsMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/admin-appeals", () => ({ getAppeal: getMock, listAppeals: listMock, getAppealStats: statsMock }));
vi.mock("@/lib/actions/admin-appeals", () => ({ decideAppeal: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));

const { AppealView, undoOf } = await import("@/components/admin/appeal-view");
const { AppealQueue } = await import("@/components/admin/appeal-queue");

const appeal = (over: Partial<AppealDetail> = {}): AppealDetail => ({
  id: 7,
  decisionId: 42,
  targetType: "partner_profile",
  targetId: "org-1",
  action: "content_hidden",
  title: "Alpha Recruit",
  organizationId: "org-1",
  organizationName: "Alpha Recruit",
  decisionReasons: "Claims of placements never made.",
  decidedOn: "2026-10-20T09:00:00+00:00",
  decisionReportId: 12,
  inEffect: true,
  ownDecision: false,
  status: "open",
  grounds: "Every placement is documented.",
  lodgedAt: "2026-10-21T09:00:00+00:00",
  dueAt: "2026-10-28T09:00:00+00:00",
  overdue: false,
  reasons: null,
  decidedAt: null,
  ...over,
});

async function render(detail: AppealDetail, canAct = true) {
  getMock.mockResolvedValue(detail);
  return renderToStaticMarkup(await AppealView({ lang: "en", id: detail.id, canAct }));
}

// FR-S1 AC9, AC11: the appeal page of the console.
describe("the appeal page of the console", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the decision with its reasons and report, the grounds and the due time, and offers both outcomes to a second reviewer", async () => {
    const html = await render(appeal());
    expect(html).toContain("Appeal A-000007");
    expect(html).toContain("Partner profile hidden");
    expect(html).toContain("Claims of placements never made.");
    expect(html).toContain('href="/en/admin/reports/12"');
    expect(html).toContain("Every placement is documented.");
    expect(html).toContain("Appeal under review");
    expect(html).toContain(">Reverse the decision</button>");
    expect(html).toContain(">Uphold the decision</button>");
  });

  it("tells the administrator who took the decision that another one decides", async () => {
    const html = await render(appeal({ ownDecision: true }));
    expect(html).toContain("You took this decision, so another Trust &amp; Safety administrator decides the appeal.");
    expect(html).not.toContain(">Reverse the decision</button>");
  });

  it("is read only for a Platform Administrator", async () => {
    const html = await render(appeal(), false);
    expect(html).toContain("Read only. Trust &amp; Safety decide on appeals.");
    expect(html).not.toContain(">Uphold the decision</button>");
  });

  it("shows the outcome and its reasons once decided, and flags an overdue appeal", async () => {
    const decided = await render(appeal({ status: "restored", reasons: "The documents match the claims.", decidedAt: "2026-10-24T09:00:00+00:00" }));
    expect(decided).toContain("Decision reversed");
    expect(decided).toContain("The documents match the claims.");
    expect(decided).not.toContain(">Reverse the decision</button>");
    expect(await render(appeal({ overdue: true }))).toContain("Overdue");
  });
});

// FR-S1 AC11 and the KPI: the appeals page of the console.
describe("the appeals queue of the console", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says when no appeal is open and shows the reversal rate", async () => {
    listMock.mockResolvedValue({ rows: [], next: null });
    statsMock.mockResolvedValue({ decided: 4, restored: 3, open: 0, overdue: 0 });
    const html = renderToStaticMarkup(await AppealQueue({ lang: "en", status: "open", after: null }));
    expect(html).toContain("No open appeals");
    expect(html).toContain("75% (3 of 4)");
  });

  it("lists open appeals with their due time and overdue flag, and continues after the last row", async () => {
    listMock.mockResolvedValue({
      rows: [
        { id: 7, decisionId: 42, targetType: "job", title: "Welder", organizationName: "Acme Bau", status: "open", lodgedAt: "2026-10-20T09:00:00+00:00", dueAt: "2026-10-27T09:00:00+00:00", overdue: true, decidedAt: null },
      ],
      next: { dueAt: "2026-10-27T09:00:00+00:00", id: 7 },
    });
    statsMock.mockResolvedValue({ decided: 0, restored: 0, open: 1, overdue: 1 });
    const html = renderToStaticMarkup(await AppealQueue({ lang: "en", status: "open", after: null }));
    expect(html).toContain('href="/en/admin/appeals/7"');
    expect(html).toContain("Vacancy: </span>Welder");
    expect(html).toContain("Overdue");
    expect(html).toContain("No appeal decided yet");
    expect(html).toContain("after=2026-10-27T09%3A00%3A00%2B00%3A00_7");
    expect(listMock).toHaveBeenCalledWith("open", null);
  });
});

// What the reverse dialog says a reversal does.
describe("the reversal statement of an appeal", () => {
  it("names what each decision gets back, and that nothing is undone once the decision is no longer in effect", () => {
    expect(undoOf(appeal())).toBe("The partner profile is shown again, unless the partner is suspended.");
    expect(undoOf(appeal({ action: "job_hidden", targetType: "job" }))).toBe("The vacancy is shown again, unless its organisation is suspended.");
    const gone = undoOf(appeal({ action: "job_hidden", targetType: "job", inEffect: false }));
    expect(gone).toContain("or the vacancy was deleted");
    expect(gone).toContain("nothing is undone");
    expect(undoOf(appeal({ action: "something_else" }))).toBe("What the decision took away is restored.");
  });
});
