import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResponseComparison } from "@/components/responses/response-comparison";
import type { ComparedResponse } from "@/lib/dal/responses";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/responses", () => ({ decideResponse: vi.fn(), setResponseSubmissions: vi.fn() }));

const response: ComparedResponse = {
  id: "00000000-0000-4000-8000-000000000001",
  partnerId: "00000000-0000-4000-8000-000000000002",
  partnerName: "Baltic Crew",
  partnerSlug: "baltic-crew",
  partnerType: "recruitment_company",
  invitationId: null,
  status: "submitted",
  version: 1,
  updatedUnseen: false,
  capacity: 12,
  availableFrom: "2027-02-01",
  timelineNote: null,
  experienceNote: "Ten years of welding crews.",
  feeModel: "fee_per_hire",
  feeAmount: 1500,
  feeCurrency: "EUR",
  servedCountries: [],
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  decidedAt: null,
  decisionNote: null,
  submissionsAllowed: false,
  withdrawnAt: null,
};

describe("the comparison of responses", () => {
  const html = renderToStaticMarkup(
    <ResponseComparison
      lang="en"
      slug="acme"
      requirementId="00000000-0000-4000-8000-000000000003"
      responses={[response, { ...response, id: "00000000-0000-4000-8000-000000000004", partnerName: "Nordic Staff" }]}
      documents={[]}
      countryNames={new Map()}
      canDecide
    />,
  );

  it("positions its scrolling container, so the visually hidden text of a far column cannot widen the page at 375 px", () => {
    expect(html).toMatch(/^<div class="relative overflow-x-auto[^"]*" role="region"/);
    expect(html).toContain('<span class="sr-only"> of Nordic Staff</span>');
  });

  it("names its scrolling region", () => {
    expect(html).toMatch(/role="region" aria-label="Responses compared side by side"/);
  });

  it("shows the decision a selected or declined response has, not that it was decided", () => {
    const decided = renderToStaticMarkup(
      <ResponseComparison
        lang="en"
        slug="acme"
        requirementId="00000000-0000-4000-8000-000000000003"
        responses={[
          { ...response, status: "selected", decidedAt: "2026-11-02T10:00:00Z" },
          { ...response, id: "00000000-0000-4000-8000-000000000004", partnerName: "Nordic Staff", status: "declined", decidedAt: "2026-11-02T10:00:00Z" },
        ]}
        documents={[]}
        countryNames={new Map()}
        canDecide
      />,
    );
    const decisionRow = decided.slice(decided.indexOf(">Decision</th>"));
    expect(decisionRow).toMatch(/<td[^>]*>Selected<\/td><td[^>]*>Declined<\/td>/);
    expect(decided).not.toContain("Decided");
  });
});
