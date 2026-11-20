import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportDetail } from "@/lib/dal/admin-reports";

const getMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/admin-reports", () => ({ getReport: getMock, getPartnerModeration: vi.fn(async () => null) }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));

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
  decisionDueAt: "2026-10-08T10:00:00+00:00",
  decision: null,
  item: null,
});

async function render(contentPath: string) {
  getMock.mockResolvedValue(content(contentPath));
  return renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: false }));
}

describe("the page of a content report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releasedMock.mockResolvedValue(true);
  });

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
  beforeEach(() => releasedMock.mockResolvedValue(true));
  const ORG = "0b9c7a2e-3d4f-4e5a-8b6c-7d8e9f0a1b2c";
  const partnerReport = (overrides: Partial<ReportDetail>): ReportDetail => ({
    ...content("/en/jobs"),
    targetType: "partner_profile",
    category: "fee_demanded_from_worker",
    status: "new",
    contentPath: null,
    organization: { id: ORG, name: "Manila Skills", slug: "manila-skills", status: "active", type: "recruitment_company", moderationState: "visible" },
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

  it("links no public profile while the organisation is suspended, which has none", async () => {
    getMock.mockResolvedValue(partnerReport({ organization: { id: ORG, name: "Manila Skills", slug: "manila-skills", status: "suspended", type: "recruitment_company", moderationState: "org_suspended" } }));
    const html = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: false }));
    expect(html).not.toContain('href="/en/partners/manila-skills"');
    expect(html).toContain(`href="/en/admin/organizations/${ORG}"`);
  });

  it("shows no due time once the report is closed, and no fee label for another category", async () => {
    getMock.mockResolvedValue(partnerReport({ status: "dismissed", category: "other", resolutionNote: "Nothing in it breaks the rules.", handledAt: "2026-10-06T10:00:00+00:00" }));
    const html = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: false }));
    expect(html).not.toContain("Overdue");
    expect(html).not.toContain(">First look due<");
    expect(html).not.toContain("Fee demand");
  });
});

describe("the decision on a report (FR-S1 AC10)", () => {
  beforeEach(() => releasedMock.mockResolvedValue(true));
  const ORG = "0b9c7a2e-3d4f-4e5a-8b6c-7d8e9f0a1b2c";
  const open = (overrides: Partial<ReportDetail>): ReportDetail => ({
    ...content("/en/jobs"),
    targetType: "partner_profile",
    status: "in_review",
    contentPath: null,
    organization: { id: ORG, name: "Manila Skills", slug: "manila-skills", status: "active", type: "recruitment_company", moderationState: "visible" },
    resolutionNote: null,
    handledAt: null,
    ...overrides,
  });

  it("offers Trust & Safety Hide, Suspend organisation and Dismiss on a partner profile, with the decision target", async () => {
    getMock.mockResolvedValue(open({}));
    const html = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: true }));
    for (const label of [">Hide<", ">Suspend organisation<", ">Dismiss<"]) expect(html).toContain(label);
    expect(html).not.toContain(">Mark actioned<");
    expect(html).not.toContain(">Mark in review<");
    expect(html).toContain("Decision due");
    expect(html).toContain(">First look due<");
    expect(html).not.toContain(">Due<");
    expect(html).toContain('dateTime="2026-10-08T10:00:00+00:00"');
  });

  it("offers the decision in effect for a second report on a partner already hidden or suspended", async () => {
    getMock.mockResolvedValue(
      open({ organization: { id: ORG, name: "Manila Skills", slug: "manila-skills", status: "suspended", type: "recruitment_company", moderationState: "org_suspended" } }),
    );
    const suspended = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: true }));
    expect(suspended).not.toContain(">Hide<");
    expect(suspended).not.toContain(">Suspend organisation<");
    expect(suspended).toContain(">Suspend organisation (already suspended)<");
    expect(suspended).toContain(">Dismiss<");
    getMock.mockResolvedValue(
      open({ organization: { id: ORG, name: "Manila Skills", slug: "manila-skills", status: "active", type: "recruitment_company", moderationState: "hidden" } }),
    );
    const hidden = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: true }));
    expect(hidden).toContain(">Hide (already hidden)<");
    expect(hidden).toContain(">Suspend organisation<");
  });

  it("keeps the Phase 1 moves while release 2a is off: Dismiss and Mark actioned with a note, no Hide or Suspend", async () => {
    releasedMock.mockResolvedValue(false);
    getMock.mockResolvedValue(open({ targetType: "job", job: { id: "j", title: "Welder", status: "open", moderationState: "visible" } }));
    const html = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: true }));
    expect(html).toContain(">Dismiss<");
    expect(html).toContain(">Mark actioned<");
    expect(html).not.toMatch(/>(Hide|Suspend organisation)</);
    expect(html).toContain("done with their own controls");
  });

  it("closes a report about a page with a note, and shows a Platform Administrator no decision at all", async () => {
    getMock.mockResolvedValue({ ...content("/en/pricing"), status: "new", resolutionNote: null, handledAt: null });
    const html = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: true }));
    expect(html).toContain(">Mark in review<");
    expect(html).toContain(">Mark actioned<");
    expect(html).toContain(">Dismiss<");
    expect(html).not.toContain(">Hide<");

    getMock.mockResolvedValue(open({}));
    const readOnly = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: false }));
    expect(readOnly).toContain("Read only");
    expect(readOnly).not.toMatch(/>(Hide|Suspend organisation|Dismiss)</);
  });

  it("shows the decision and the statement of reasons of a closed report", async () => {
    getMock.mockResolvedValue(open({ status: "actioned", decision: "content_hidden", resolutionNote: "Claims of placements never made.", handledAt: "2026-10-06T10:00:00+00:00" }));
    const html = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: true }));
    expect(html).toContain("Partner profile hidden");
    expect(html).toContain("Statement of reasons");
    expect(html).toContain("Claims of placements never made.");
    expect(html).not.toContain("Decision due");
  });
});

describe("the page of a report about a job order, response or submission (FR-S1, V57)", () => {
  beforeEach(() => releasedMock.mockResolvedValue(true));
  const ORG = "0b9c7a2e-3d4f-4e5a-8b6c-7d8e9f0a1b2c";
  const ITEM = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
  const itemReport = (overrides: Partial<ReportDetail>): ReportDetail => ({
    ...content("/en/jobs"),
    status: "in_review",
    contentPath: null,
    resolutionNote: null,
    handledAt: null,
    organization: { id: ORG, name: "Manila Skills", slug: "manila-skills", status: "active", type: "recruitment_company", moderationState: "visible" },
    ...overrides,
  });

  it("shows a response in context, with the partner and Hide, Suspend organisation and Dismiss", async () => {
    getMock.mockResolvedValue(
      itemReport({
        targetType: "partner_response",
        item: {
          id: ITEM,
          moderationState: "visible",
          context: { requirement_title: "Welders for Hamburg", capacity: 12, experience_note: "We placed 40 welders in 2025.", fee_model: "fee_per_hire", fee_amount: 800, fee_currency: "EUR" },
        },
      }),
    );
    const html = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: true }));
    for (const text of ["Partner response", "Welders for Hamburg", "We placed 40 welders in 2025.", "EUR 800.00 per hire", "Manila Skills", ">Hide<", ">Suspend organisation<", ">Dismiss<"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain(">Mark actioned<");
  });

  it("never shows the candidate of a submission, and offers the hide in effect once it is hidden", async () => {
    getMock.mockResolvedValue(
      itemReport({
        targetType: "candidate_submission",
        category: "fee_demanded_from_worker",
        item: { id: ITEM, moderationState: "hidden", context: { requirement_title: "Welders for Hamburg", status: "submitted", note: "Ready to travel." } },
      }),
    );
    const html = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: true }));
    expect(html).toContain("Fee demand");
    expect(html).toContain("The candidate is not shown to staff");
    expect(html).toContain("Ready to travel.");
    expect(html).toContain(">Hide (already hidden)<");
  });

  it("names a closed decision on a job order by its kind", async () => {
    getMock.mockResolvedValue(
      itemReport({
        targetType: "requirement",
        status: "actioned",
        decision: "content_hidden",
        resolutionNote: "Discriminatory wording in the job order.",
        handledAt: "2026-10-06T10:00:00+00:00",
        item: { id: ITEM, moderationState: "hidden", context: { title: "Welders for Hamburg", workers_needed: 30, country_code: "DE" } },
      }),
    );
    const html = renderToStaticMarkup(await ReportView({ lang: "en", id: 5, canAct: true }));
    expect(html).toContain("Job order hidden");
    expect(html).not.toContain("Partner profile hidden");
  });
});
