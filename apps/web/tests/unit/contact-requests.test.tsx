import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTACT_MESSAGE_MAX,
  contactAgainFrom,
  sendRefusalText,
  sentNextStep,
  withdrawConfirmText,
} from "@/lib/contact-requests/presentation";
import { contactRequestFormSchema } from "@/lib/validation/contact-request";

const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const requireCandidateMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const sentMock = vi.hoisted(() => vi.fn());
const receivedMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/en" }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock, requireCandidate: requireCandidateMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/reference", () => ({
  getCountries: async () => [{ code: "DE", name: "Germany" }, { code: "NG", name: "Nigeria" }],
  getOccupations: async () => [{ code: "7212", label: "Welders and flame cutters" }],
}));
vi.mock("@/lib/dal/contact-requests", () => ({ listSentContactRequests: sentMock, listReceivedContactRequests: receivedMock }));
vi.mock("@/lib/actions/contact-requests", () => ({ respondToContactRequest: vi.fn(), withdrawContactRequest: vi.fn() }));
vi.mock("@/lib/actions/messaging", () => ({ openConversation: vi.fn() }));
vi.mock("@/lib/dal/settings", () => ({
  getPublicSettings: async () => ({ contact_request_repeat_days: "30", contact_request_decline_days: "90", contact_request_expiry_days: "30" }),
}));

const { default: OrganizationContactRequestsPage } = await import("@/app/[lang]/(app)/org/[slug]/contact-requests/page");
const { default: ContactRequestsPage } = await import("@/app/[lang]/(app)/contact-requests/page");

const REQUEST = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

const sent = {
  id: REQUEST,
  cardId: CARD,
  status: "pending",
  message: "We would like to talk about welding work in Hamburg.",
  jobTitle: "Welder MIG/MAG",
  destinationCountry: "DE",
  createdAt: "2027-02-10T09:00:00+00:00",
  expiresAt: "2027-03-12T09:00:00+00:00",
  respondedAt: null,
  sentByMe: true,
  headline: "MIG welder",
  occupationId: "7212",
  currentCountry: "NG",
  workerName: null,
  conversationId: null,
} as const;

const received = {
  id: REQUEST,
  status: "pending",
  message: "We would like to talk about welding work in Hamburg.",
  organizationName: "Acme Bau",
  organizationType: "employer",
  organizationCountry: "DE",
  jobId: "44444444-4444-4444-8444-444444444444",
  jobTitle: "Welder MIG/MAG",
  jobCountry: "DE",
  createdAt: "2027-02-10T09:00:00+00:00",
  expiresAt: "2027-03-12T09:00:00+00:00",
  respondedAt: null,
  conversationId: null,
} as const;

async function html(element: Promise<React.ReactNode>): Promise<string> {
  const { prelude } = await prerender(await element);
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}

const orgPage = (searchParams: Record<string, string> = {}) =>
  html(OrganizationContactRequestsPage({ params: Promise.resolve({ lang: "en", slug: "acme" }), searchParams: Promise.resolve(searchParams) }));
const workerPage = () => html(ContactRequestsPage({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve({}) }));

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue({
    user: { id: "u1" },
    organization: { id: "org-1", slug: "acme", displayName: "Acme Bau", type: "employer", role: "member", suspended: false },
  });
  requireCandidateMock.mockResolvedValue({ id: "w1" });
  sentMock.mockResolvedValue({ items: [sent], nextCursor: null });
  receivedMock.mockResolvedValue([received]);
});

describe("the contact request form (FR-Q3 AC2)", () => {
  it("takes 1 to 1,000 characters after trimming, and an optional vacancy", () => {
    expect(contactRequestFormSchema.safeParse({ message: "x", jobId: "" }).success).toBe(true);
    expect(contactRequestFormSchema.safeParse({ message: "y".repeat(CONTACT_MESSAGE_MAX), jobId: REQUEST }).success).toBe(true);
    expect(contactRequestFormSchema.safeParse({ message: "", jobId: "" }).success).toBe(false);
    expect(contactRequestFormSchema.safeParse({ message: " \n\t ", jobId: "" }).success).toBe(false);
    expect(contactRequestFormSchema.safeParse({ message: "y".repeat(CONTACT_MESSAGE_MAX + 1), jobId: "" }).success).toBe(false);
    expect(contactRequestFormSchema.safeParse({ message: "Hello\u0007there", jobId: "" }).success).toBe(false);
    expect(contactRequestFormSchema.safeParse({ message: "Hello", jobId: "not-a-vacancy" }).success).toBe(false);
    expect(contactRequestFormSchema.parse({ message: "  Line one\r\nLine two  ", jobId: "" }).message).toBe("Line one\nLine two");
  });

  it("says why the database refused, so the dialog can keep the message (AC12)", () => {
    expect(sendRefusalText({ message: "CHARA_RATE_LIMITED", details: "contact_requests_per_day" })).toContain("today");
    expect(sendRefusalText({ message: "CHARA_CONFLICT", details: "declined" })).toContain("90 days");
    expect(sendRefusalText({ message: "CHARA_CONFLICT", details: "pending" })).toContain("30 days");
    expect(sendRefusalText({ message: "CHARA_FORBIDDEN", details: "licensed_partner_required" })).toContain("licensed recruitment partner");
    expect(sendRefusalText({ message: "CHARA_FORBIDDEN", details: "direct_hiring_blocked" })).toContain("not allowed");
    expect(sendRefusalText({ message: "CHARA_FORBIDDEN", details: null })).toBeNull();
  });
});

describe("the organisation's contact requests (FR-Q3 AC7, AC8, AC10; NFR-S9, NFR-U4)", () => {
  it("shows a pending request by its card, with its status, next step and Withdraw, and nothing that names the worker", async () => {
    const page = await orgPage();
    expect(page).toContain("Welders and flame cutters");
    expect(page).toContain("Waiting for the worker");
    expect(page).toContain("You can withdraw the request while it waits.");
    expect(page).toContain('aria-label="Withdraw the contact request: Welders and flame cutters"');
    expect(page).toContain("Vacancy: Welder MIG/MAG");
    expect(page).not.toMatch(/Amina|Okafor|@/);
  });

  it("names the worker and links the conversation once the worker accepted", async () => {
    sentMock.mockResolvedValue({
      items: [{ ...sent, status: "accepted", workerName: "Amina Okafor", conversationId: CONVERSATION, respondedAt: "2027-02-11T09:00:00+00:00" }],
      nextCursor: null,
    });
    const page = await orgPage();
    expect(page).toContain(">Amina Okafor</h2>");
    expect(page).toContain(`href="/en/org/acme/messages/${CONVERSATION}"`);
    expect(page).not.toContain("Withdraw request");
  });

  it("calls an expired request No answer and a declined one Declined, without a reason", async () => {
    vi.useFakeTimers({ now: new Date("2027-03-15T09:00:00+00:00"), toFake: ["Date"] });
    try {
      sentMock.mockResolvedValue({
        items: [{ ...sent, status: "expired" }, { ...sent, id: CARD, status: "declined", respondedAt: "2027-02-12T09:00:00+00:00" }],
        nextCursor: null,
      });
      const page = await orgPage();
      expect(page).toContain("No answer");
      expect(page).toContain("Declined");
      expect(page).toContain("The worker did not answer within 30 days. You can send a new request from Find Workers.");
      expect(page).toContain("The worker declined. Your organisation can send this worker a new request from 13 May 2027.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters by status from the address and shows an empty state with the way to Find Workers", async () => {
    sentMock.mockResolvedValue({ items: [], nextCursor: null });
    const page = await orgPage({ status: "accepted" });
    expect(sentMock).toHaveBeenCalledWith("org-1", { status: "accepted", cursor: null });
    expect(page).toContain("No contact requests with this status");
    expect(page).toContain('href="/en/org/acme/find-workers"');
    expect(page).toMatch(/aria-current="page"[^>]*>Accepted</);
  });

  it("does not exist while Find Workers is off", async () => {
    releasedMock.mockResolvedValue(false);
    await expect(orgPage()).rejects.toThrow("NOT_FOUND");
  });
});

describe("when the organisation may ask a worker again (FR-Q3 AC3, AC5; NFR-U4)", () => {
  const periods = { repeatDays: 30, declineDays: 90, expiryDays: 30 };
  const now = Date.parse("2027-02-20T09:00:00+00:00");
  const withdrawn = { status: "withdrawn", createdAt: "2027-02-10T09:00:00+00:00", respondedAt: null } as const;

  it("counts the repeat period from when the request was sent, and the decline period from the answer", () => {
    expect(contactAgainFrom(withdrawn, periods, now)).toBe("2027-03-12T09:00:00.000Z");
    expect(contactAgainFrom({ ...withdrawn, status: "declined", respondedAt: "2027-02-11T09:00:00+00:00" }, periods, now)).toBe(
      "2027-05-12T09:00:00.000Z",
    );
    expect(contactAgainFrom({ ...withdrawn, status: "pending" }, periods, now)).toBeNull();
    expect(contactAgainFrom(withdrawn, periods, Date.parse("2027-04-01T00:00:00Z"))).toBeNull();
  });

  it("asks before a withdrawal, saying it cannot be undone and from when the organisation may ask again", () => {
    expect(withdrawConfirmText("2027-03-12T09:00:00.000Z")).toBe(
      "The worker can no longer answer it. This cannot be undone. Your organisation can send this worker a new request from 12 March 2027.",
    );
    expect(withdrawConfirmText(null)).toBe("The worker can no longer answer it. This cannot be undone. You can send a new request from Find Workers.");
  });

  it("names the date from the settings in the next step of a withdrawn and a declined request", () => {
    expect(sentNextStep(withdrawn, periods, now)).toBe("You withdrew this request. Your organisation can send this worker a new request from 12 March 2027.");
    expect(sentNextStep(withdrawn, { ...periods, repeatDays: 7 }, now)).toBe("You withdrew this request. You can send a new request from Find Workers.");
    expect(sentNextStep({ ...withdrawn, status: "declined", respondedAt: "2027-02-11T09:00:00+00:00" }, { ...periods, declineDays: 60 }, now)).toBe(
      "The worker declined. Your organisation can send this worker a new request from 12 April 2027.",
    );
  });
});

describe("the worker's contact requests (FR-Q3 AC10, AC11; NFR-U4)", () => {
  it("shows a waiting request with the company, country, message, vacancy and date, what accepting shares, and named answers", async () => {
    const page = await workerPage();
    expect(page).toContain("Acme Bau");
    expect(page).toContain("Employer · Germany · Received");
    expect(page).toContain("We would like to talk about welding work in Hamburg.");
    expect(page).toContain(`href="/en/jobs/${received.jobId}"`);
    expect(page).toContain("Accepting shares your first and last name with Acme Bau only");
    expect(page).toContain('aria-label="Accept the contact request from Acme Bau"');
    expect(page).toContain('aria-label="Decline the contact request from Acme Bau"');
  });

  it("shows an expired request as no longer open, with its next step", async () => {
    receivedMock.mockResolvedValue([{ ...received, status: "expired" }]);
    const page = await workerPage();
    expect(page).toContain("No request is waiting for your answer.");
    expect(page).toContain("Expired");
    expect(page).not.toContain("Accept the contact request");
  });

  it("says No contact requests when there are none", async () => {
    receivedMock.mockResolvedValue([]);
    expect(await workerPage()).toContain("No contact requests");
  });
});
