import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";
import type { ContactRequestCounts } from "@/lib/dashboard/connections";
import type { MyCard } from "@/lib/dal/worker-visibility";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const {
  contactRequestsText,
  matchingWorkersText,
  organizationUnread,
  parseMatchingWorkers,
  partnerRequestLines,
} = await import("@/lib/dashboard/connections");
const { EmployerRequestsCard, MatchingWorkersCard, PartnerRequestsCard, UnreadMessagesCard } = await import(
  "@/components/dashboard/connection-blocks"
);
const { FindWorkersCard } = await import("@/components/dashboard/find-workers-card");

const html = async (element: React.ReactElement) => {
  const { prelude } = await prerender(element);
  return (await new Response(prelude).text()).replace(/<!-- -->|<!--\/?\$-->/g, "");
};

const row = (over: Partial<Parameters<typeof parseMatchingWorkers>[0]> = {}) => ({
  matching_workers: null,
  matching_workers_suppressed: false,
  matching_workers_fewer_than: null,
  matching_workers_reason: null,
  ...over,
});

describe("matching workers (FR-R5 AC5, AC6)", () => {
  it("reads a count, a suppressed count, a reason, or nothing while Find Workers is off", () => {
    expect(parseMatchingWorkers(row({ matching_workers: 40 }))).toEqual({ kind: "count", count: 40 });
    expect(parseMatchingWorkers(row({ matching_workers: 0 }))).toEqual({ kind: "count", count: 0 });
    expect(parseMatchingWorkers(row({ matching_workers_suppressed: true, matching_workers_fewer_than: 5 }))).toEqual({
      kind: "suppressed",
      fewerThan: 5,
    });
    expect(parseMatchingWorkers(row({ matching_workers_reason: "feature_not_in_plan" }))).toEqual({
      kind: "unavailable",
      reason: "feature_not_in_plan",
    });
    expect(parseMatchingWorkers(row())).toBeNull();
  });

  it("says how many visible workers match, fewer than the threshold, or what to try when none does", () => {
    expect(matchingWorkersText({ kind: "count", count: 40 }, "employer")).toBe("40 workers who chose to be visible match your requirements.");
    expect(matchingWorkersText({ kind: "count", count: 1 }, "partner")).toBe(
      "1 worker who chose to be visible matches the occupations and countries you serve.",
    );
    expect(matchingWorkersText({ kind: "suppressed", fewerThan: 5 }, "employer")).toBe("Fewer than 5 workers match your requirements.");
    expect(matchingWorkersText({ kind: "count", count: 0 }, "employer")).toMatch(/^No visible worker matches/);
  });

  it("draws the count with Find workers and never a card", async () => {
    const page = await html(
      <MatchingWorkersCard value={{ kind: "count", count: 40 }} audience="employer" findWorkersHref="/en/org/acme/find-workers" billingHref={null} />,
    );
    expect(page).toContain(">Matching workers</h2>");
    expect(page).toContain("<dt");
    expect(page).toContain(">40<");
    expect(page).toContain("40 workers who chose to be visible match your requirements.");
    expect(page).toMatch(/href="\/en\/org\/acme\/find-workers"[^>]*>Find workers/);
    expect(page).not.toMatch(/card_id|Amina|<img/);
  });

  it("offers a manager of a plan without Find Workers the upgrade, and tells a member who decides", async () => {
    const value = { kind: "unavailable", reason: "feature_not_in_plan" } as const;
    let page = await html(<MatchingWorkersCard value={value} audience="employer" findWorkersHref="/x" billingHref="/en/org/free/billing" />);
    expect(page).toContain("Find Workers is included in paid plans.");
    expect(page).toMatch(/href="\/en\/org\/free\/billing"[^>]*>Upgrade your plan/);
    expect(page).not.toContain("Find workers<");
    page = await html(<MatchingWorkersCard value={value} audience="employer" findWorkersHref="/x" billingHref={null} />);
    expect(page).toContain("Ask an owner or admin of your company to upgrade.");
    page = await html(
      <MatchingWorkersCard value={{ kind: "unavailable", reason: "not_listed" }} audience="partner" findWorkersHref="/x" billingHref="/b" />,
    );
    expect(page).toContain("Find Workers opens once your company is approved and listed.");
    expect(page).not.toContain("Upgrade");
  });

  it("shows a suppressed count as fewer than the threshold, not as a number", async () => {
    const page = await html(<MatchingWorkersCard value={{ kind: "suppressed", fewerThan: 5 }} audience="employer" findWorkersHref="/x" billingHref={null} />);
    expect(page).toContain("Fewer than 5 workers match your requirements.");
    expect(page).not.toContain("<dt");
  });
});

describe("unread messages (FR-R3, FR-R4, FR-R5 release 2c)", () => {
  it("counts the conversations of the organisation only", () => {
    const counts = [
      { conversationId: "c1", organizationId: "org-a", unread: 3 },
      { conversationId: "c2", organizationId: "org-b", unread: 7 },
      { conversationId: "c3", organizationId: "org-a", unread: 1 },
      { conversationId: "c4", organizationId: null, unread: 2 },
    ];
    expect(organizationUnread(counts, "org-a")).toBe(4);
    expect(organizationUnread(counts, "org-c")).toBe(0);
  });

  it("names the count with its label and leads to the inbox (NFR-U4)", async () => {
    let page = await html(<UnreadMessagesCard unread={4} lang="en" slug="acme" lockedHref={null} />);
    expect(page).toMatch(/<dt[^>]*>Unread messages<\/dt><dd[^>]*><span[^>]*>4<\/span>/);
    expect(page).toMatch(/href="\/en\/org\/acme\/messages"[^>]*>Read the unread messages/);
    page = await html(<UnreadMessagesCard unread={0} lang="en" slug="acme" lockedHref={null} />);
    expect(page).toContain("No unread messages.");
    expect(page).toMatch(/href="\/en\/org\/acme\/messages"[^>]*>Open your messages/);
    expect(page).not.toContain("<dt");
  });

  it("asks an owner or admin at aal1 for the two-step check instead of a count", async () => {
    const page = await html(<UnreadMessagesCard unread={0} lang="en" slug="acme" lockedHref="/en/mfa?next=x" />);
    expect(page).toMatch(/href="\/en\/mfa\?next=x"[^>]*>Complete the two-step check/);
    expect(page).not.toContain("No unread messages");
  });
});

describe("partner requests (FR-R4 AC6) and the employer's requests", () => {
  it("splits the requests waiting for the partner into inquiries and workforce requests", () => {
    expect(partnerRequestLines({ total: 3, inquiries: 2 })).toEqual([
      { key: "inquiries", label: "Inquiries", count: 2 },
      { key: "workforce", label: "Workforce requests", count: 1 },
    ]);
    expect(partnerRequestLines({ total: 1, inquiries: 0 })).toEqual([{ key: "workforce", label: "Workforce requests", count: 1 }]);
    expect(partnerRequestLines({ total: 0, inquiries: 0 })).toEqual([]);
  });

  it("answers inquiries in the inbox and workforce requests from the invitations", async () => {
    let page = await html(<PartnerRequestsCard requests={{ total: 3, inquiries: 2 }} lang="en" slug="rekrut" />);
    expect(page).toContain("Inquiries waiting for your answer");
    expect(page).toContain("Workforce requests waiting for your answer");
    expect(page).toMatch(/href="\/en\/org\/rekrut\/messages\?context=inquiry"[^>]*>Answer the inquiries/);
    expect(page).toMatch(/href="\/en\/org\/rekrut\/invitations"[^>]*>Respond to request/);
    page = await html(<PartnerRequestsCard requests={{ total: 1, inquiries: 1 }} lang="en" slug="rekrut" />);
    expect(page).not.toContain("Respond to request");
    page = await html(<PartnerRequestsCard requests={{ total: 1, inquiries: 0 }} lang="en" slug="rekrut" />);
    expect(page).toMatch(/href="\/en\/org\/rekrut\/invitations"[^>]*>Respond to request/);
    page = await html(<PartnerRequestsCard requests={{ total: 0, inquiries: 0 }} lang="en" slug="rekrut" />);
    expect(page).toContain("No inquiries or workforce requests wait for your answer.");
  });

  it("tells the employer what waits and what was answered, or how to send one", async () => {
    let page = await html(<EmployerRequestsCard requests={{ waiting: 2, answered: 1 }} lang="en" slug="acme" findPartnersHref="/en/partners/recruitment" />);
    expect(page).toContain("Waiting for the partner&#x27;s answer");
    expect(page).toMatch(/href="\/en\/org\/acme\/messages"[^>]*>Read the partners&#x27; answers/);
    page = await html(<EmployerRequestsCard requests={{ waiting: 0, answered: 0 }} lang="en" slug="acme" findPartnersHref="/en/partners/recruitment" />);
    expect(page).toContain("Send an inquiry or request workforce from a partner&#x27;s profile.");
    expect(page).toMatch(/href="\/en\/partners\/recruitment"[^>]*>Find partners/);
  });
});

describe("the worker's contact requests (FR-Q1 AC10)", () => {
  it("says how many were received and how many wait", () => {
    expect(contactRequestsText({ pending: 0, received: 0 })).toBe("No contact requests received yet.");
    expect(contactRequestsText({ pending: 2, received: 3 })).toBe("3 contact requests received, 2 waiting for your answer.");
    expect(contactRequestsText({ pending: 0, received: 1 })).toBe("1 contact request received.");
  });

  const card = (visible: boolean): MyCard => ({
    card: {} as MyCard["card"],
    visible,
    optedIn: visible,
    visibleSince: null,
    consentVersion: null,
    currentVersion: null,
    confirmBy: null,
    sections: { training: false, employmentHistory: false, industries: false },
  });
  const counts = (value: ContactRequestCounts) => Promise.resolve(value);

  it("shows the visible worker the number received with the way to answer", async () => {
    const page = await html(<FindWorkersCard lang="en" card={card(true)} requests={counts({ pending: 2, received: 3 })} />);
    expect(page).toContain("Visible in Find Workers");
    expect(page).toContain("3 contact requests received, 2 waiting for your answer.");
    expect(page).toMatch(/href="\/en\/contact-requests"[^>]*>Answer the contact requests/);
  });

  it("keeps a waiting request in view after a withdrawal and says nothing of none to a worker who is not visible", async () => {
    let page = await html(<FindWorkersCard lang="en" card={card(false)} requests={counts({ pending: 1, received: 1 })} />);
    expect(page).toContain("Not visible in Find Workers");
    expect(page).toContain("1 contact request received, 1 waiting for your answer.");
    page = await html(<FindWorkersCard lang="en" card={card(false)} requests={counts({ pending: 0, received: 0 })} />);
    expect(page).not.toContain("contact request");
  });

  it("keeps the card when the count fails, with the error in place of the count", async () => {
    const failed = Promise.reject(new Error("down"));
    void failed.catch(() => undefined);
    const page = await html(<FindWorkersCard lang="en" card={card(true)} requests={failed} />);
    expect(page).toContain("Visible in Find Workers");
    expect(page).toContain("Your contact requests could not be counted");
  });
});
