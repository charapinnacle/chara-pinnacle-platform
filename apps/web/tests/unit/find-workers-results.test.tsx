import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerCardData } from "@/lib/find-workers/card";
import { parseFindWorkersParams } from "@/lib/find-workers/search-params";

const searchMock = vi.hoisted(() => vi.fn());
const savedMock = vi.hoisted(() => vi.fn());
const savedIdsMock = vi.hoisted(() => vi.fn());
const contactsMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/find-workers", () => ({ setSavedWorkerCard: vi.fn() }));
vi.mock("@/lib/actions/contact-requests", () => ({ sendContactRequest: vi.fn() }));
vi.mock("@/lib/dal/contact-requests", () => ({ cardContactRequests: contactsMock }));
vi.mock("@/lib/dal/find-workers", () => ({
  searchWorkers: searchMock,
  listSavedWorkerCards: savedMock,
  savedCardIds: savedIdsMock,
}));

const { FindWorkersRefusalNotice, FindWorkersResults, SavedWorkers } = await import("@/components/find-workers/find-workers-results");

const card: WorkerCardData = {
  card_id: "22222222-2222-4222-8222-222222222222",
  headline: "MIG welder",
  occupation_id: "7212",
  skills: ["Welding"],
  years_experience: 6,
  languages: [{ code: "de", level: "B2" }],
  availability: "now",
  available_from: null,
  current_country: "NP",
  preferred_countries: ["DE"],
  work_authorization_countries: [],
  training: null,
  employment_history: null,
  preferred_industries: null,
  preferred_employment_types: null,
  updated_at: "2027-02-09T10:00:00+00:00",
};
const names = {
  countries: { NP: "Nepal", DE: "Germany" },
  occupations: { "7212": "Welders and flame cutters" },
  languages: { de: "German" },
  industries: {},
};
const vacancies = [{ id: "44444444-4444-4444-8444-444444444444", title: "Welder MIG/MAG" }];
const context = { lang: "en", slug: "acme", names, canManage: true, partnerSegment: null, requirementId: null, requirementCountry: null, vacancies };

const render = async (element: React.ReactNode) => {
  const { prelude } = await prerender(element);
  return (await new Response(prelude).text()).replace(/<!-- -->|<!--\/?\$-->/g, "");
};

beforeEach(() => {
  vi.clearAllMocks();
  savedIdsMock.mockResolvedValue(new Set<string>());
  contactsMock.mockResolvedValue(new Map());
});

describe("the Find Workers results (FR-Q2 AC6, AC10, AC12)", () => {
  it("shows each card with what it matched, the rule notice with the way to partners, Save, and the count in a polite live region", async () => {
    searchMock.mockResolvedValue({
      state: "found",
      results: [{ card, directContact: "partner_required", notice: "Hiring from Nepal needs a licensed partner.", matchedOn: ["occupation", "destination"] }],
      nextCursor: "ab12",
      cursorIgnored: false,
    });
    const { filters } = parseFindWorkersParams({ occupation: "7212", destination: "DE" });
    const html = await render(<FindWorkersResults organizationId="org" filters={filters} context={context} languages={names.languages} />);
    expect(html).toMatch(/role="status" aria-live="polite"[^>]*>1 worker shown\. More are on the next page\./);
    expect(html).toContain("Welders and flame cutters");
    expect(html).toContain("Matched on: occupation, destination DE");
    expect(html).toContain("Contact through a licensed partner");
    expect(html).toContain("Hiring from Nepal needs a licensed partner.");
    expect(html).toContain('href="/en/partners/recruitment?sources_from=NP"');
    expect(html).toContain('aria-label="Save: Welders and flame cutters"');
    expect(html).toContain('href="/en/org/acme/find-workers?occupation=7212&amp;destination=DE&amp;cursor=ab12"');
  });

  it("offers Send contact request while direct contact is allowed, and the date of a request that stops another (FR-Q3 AC12)", async () => {
    const other = { ...card, card_id: "55555555-5555-4555-8555-555555555555" };
    searchMock.mockResolvedValue({
      state: "found",
      results: [
        { card, directContact: "allowed", notice: "", matchedOn: [] },
        { card: other, directContact: "allowed", notice: "", matchedOn: [] },
      ],
      nextCursor: null,
      cursorIgnored: false,
    });
    contactsMock.mockResolvedValue(new Map([[other.card_id, { requestId: "33333333-3333-4333-8333-333333333333", status: "pending", sentAt: "2027-02-10T09:00:00+00:00", canSend: false }]]));
    const { filters } = parseFindWorkersParams({});
    const html = await render(<FindWorkersResults organizationId="org" filters={filters} context={context} languages={{}} />);
    expect(contactsMock).toHaveBeenCalledWith("org", [card.card_id, other.card_id]);
    expect(html.match(/aria-label="Send contact request: Welders and flame cutters"/g)).toHaveLength(1);
    expect(html).toContain("Request sent on <time");
    expect(html).toContain("10 February 2027");
    expect(html).toContain('href="/en/org/acme/contact-requests"');
    expect(html).toContain("Waiting for the worker");
  });

  it("offers no Send button where the rules require a licensed partner (FR-Q3 AC6)", async () => {
    searchMock.mockResolvedValue({
      state: "found",
      results: [{ card, directContact: "partner_required", notice: "Hiring from Nepal needs a licensed partner.", matchedOn: [] }],
      nextCursor: null,
      cursorIgnored: false,
    });
    const { filters } = parseFindWorkersParams({});
    const html = await render(<FindWorkersResults organizationId="org" filters={filters} context={context} languages={{}} />);
    expect(html).not.toContain("Send contact request");
  });

  it("offers Clear filters when nothing matches, keeping the requirement", async () => {
    searchMock.mockResolvedValue({ state: "found", results: [], nextCursor: null, cursorIgnored: false });
    const requirement = "33333333-3333-4333-8333-333333333333";
    const { filters } = parseFindWorkersParams({ q: "welder", requirement });
    const html = await render(
      <FindWorkersResults organizationId="org" filters={filters} context={{ ...context, requirementId: requirement }} languages={{}} />,
    );
    expect(html).toContain("No workers match your search");
    expect(html).toContain(`href="/en/org/acme/find-workers?requirement=${requirement}"`);
  });

  it("explains a free plan with Upgrade for owners and admins, and asks a member to ask them", async () => {
    let html = await render(<FindWorkersRefusalNotice reason="plan_required" context={context} />);
    expect(html).toContain("Find Workers is part of the paid plans.");
    expect(html).toContain('href="/en/org/acme/billing"');
    html = await render(<FindWorkersRefusalNotice reason="plan_required" context={{ ...context, canManage: false }} />);
    expect(html).toContain("Ask an owner or admin of your organisation to choose a plan.");
  });

  it("shows a saved card whose worker is no longer visible without any card field", async () => {
    savedMock.mockResolvedValue([{ cardId: card.card_id, visible: false }]);
    const html = await render(<SavedWorkers organizationId="org" context={context} />);
    expect(html).toContain("This worker is no longer visible.");
    expect(html).not.toContain("Welders");
    expect(html).toContain("Remove from saved");
  });
});
