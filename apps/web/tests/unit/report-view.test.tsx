import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportDetail } from "@/lib/dal/admin-reports";

const getMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/admin-reports", () => ({ getReport: getMock }));

const { ReportView } = await import("@/components/admin/report-view");

const content = (contentPath: string): ReportDetail => ({
  id: 5,
  reference: "R-000005",
  targetType: "content",
  category: "other",
  details: "A page that should not be on the site.",
  status: "dismissed",
  reporterKind: "visitor",
  reporterEmail: null,
  contentPath,
  job: null,
  organization: null,
  resolutionNote: "Nothing in it breaks the rules.",
  handledAt: "2026-10-05T10:00:00+00:00",
  createdAt: "2026-10-01T10:00:00+00:00",
  dueAt: "2026-10-05T10:00:00+00:00",
  overdue: false,
});

async function render(contentPath: string) {
  getMock.mockResolvedValue(content(contentPath));
  return renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: false }));
}

describe("the page of a content report", () => {
  beforeEach(() => vi.clearAllMocks());

  it("links a public page of the site", async () => {
    expect(await render("/en/pricing")).toContain('href="/en/pricing"');
  });

  it("shows a path that a visitor typed to a private or acting route as text, never as a link", async () => {
    for (const path of ["/en/org/acme/billing/checkout", "/en/admin/users", "/en/jobs/6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11/apply", "/api/export", "/de/pricing"]) {
      const html = await render(path);
      expect(html).toContain(path);
      expect(html).not.toContain(`href="${path}"`);
    }
  });
});

describe("the page of a partner profile report (FR-S1)", () => {
  const ORG = "0b9c7a2e-3d4f-4e5a-8b6c-7d8e9f0a1b2c";
  const partnerReport = (overrides: Partial<ReportDetail>): ReportDetail => ({
    ...content("/en/jobs"),
    targetType: "partner_profile",
    category: "fee_demanded_from_worker",
    status: "new",
    contentPath: null,
    organization: { id: ORG, name: "Manila Skills", slug: "manila-skills", status: "active" },
    resolutionNote: null,
    handledAt: null,
    overdue: true,
    ...overrides,
  });

  it("labels a fee demand, shows the due time flagged overdue and links the public profile and the organisation", async () => {
    getMock.mockResolvedValue(partnerReport({}));
    const html = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: false }));
    expect(html).toContain("Fee demand");
    expect(html).toContain("Overdue");
    expect(html).toContain('dateTime="2026-10-05T10:00:00+00:00"');
    expect(html).toContain('href="/en/partners/manila-skills"');
    expect(html).toContain(`href="/en/admin/organizations/${ORG}"`);
    expect(html).toContain("Partner profile");
  });

  it("shows no due time once the report is closed, and no fee label for another category", async () => {
    getMock.mockResolvedValue(partnerReport({ status: "dismissed", category: "other", resolutionNote: "Nothing in it breaks the rules.", handledAt: "2026-10-06T10:00:00+00:00" }));
    const html = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: false }));
    expect(html).not.toContain("Overdue");
    expect(html).not.toContain(">Due<");
    expect(html).not.toContain("Fee demand");
  });
});
