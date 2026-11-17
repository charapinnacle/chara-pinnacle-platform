import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpcMock = vi.hoisted(() => vi.fn());
const settingsMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const threadMessages = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));
vi.mock("@/lib/dal/settings", () => ({ getPublicSettings: settingsMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: async () => ({ id: "user-1", accountKind: "company" }) }));
vi.mock("@/lib/dal/connection-actions", () => ({ listConversationConnections: async () => ({}) }));
vi.mock("@/lib/dal/contact-requests", () => ({ listOpenVacancies: async () => [] }));
vi.mock("@/lib/dal/submissions", () => ({ submissionsReleased: async () => false, getSubmissionTarget: async () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
  usePathname: () => "/en/org/acme/messages/c",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/messaging/hooks", () => ({
  announceMessagesRead: vi.fn(),
  useConversationMessages: () => ({ messages: threadMessages.current, connected: false, refresh: async () => undefined, add: vi.fn() }),
}));

const { readOnlyText } = await import("@/lib/messaging/present");
const { sendMessage, setConversationBlocked } = await import("@/lib/actions/messaging");
const { ConversationThread } = await import("@/components/messaging/conversation-thread");
const { ConversationView } = await import("@/components/messaging/conversation-view");
const { reportPath } = await import("@/lib/routes");
const { isParticipantReport, isReportItem, reportTargetLabels } = await import("@/lib/validation/report");

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "44444444-4444-4444-8444-444444444444";

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE,
    kind: "text",
    body: "Pay 500 euros first",
    createdAt: "2027-02-06T10:00:00.000000+00:00",
    mine: false,
    senderKind: "organization" as const,
    senderName: "Mia Member",
    senderOrganizationName: "Acme Bau",
    senderErased: false,
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE,
    kind: "text",
    body: "Pay 500 euros first",
    created_at: "2027-02-06T10:00:00.000000+00:00",
    mine: false,
    sender_kind: "organization",
    sender_name: "Mia Member",
    sender_organization_name: "Acme Bau",
    sender_erased: false,
    ...overrides,
  };
}

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION,
    context_type: "application",
    context_id: "22222222-2222-4222-8222-222222222222",
    requirement_id: null,
    organization_id: null,
    counterpart_kind: "organization",
    counterpart_name: "Acme Bau",
    context_title: "Welder Hamburg",
    last_message_at: "2027-02-06T10:00:00.000000+00:00",
    unread: 0,
    read_only_reason: null,
    blocked_by_me: false,
    ...overrides,
  };
}

function answer(rows: { conversation?: Record<string, unknown>; messages?: unknown[] }) {
  rpcMock.mockImplementation(async (name: string) => {
    if (name === "get_conversation") return { data: [conversationRow(rows.conversation)], error: null };
    if (name === "list_messages") return { data: rows.messages ?? [], error: null };
    return { data: [], error: null };
  });
}

const breadcrumb = (counterpart: string) => <p>crumb {counterpart}</p>;

beforeEach(() => {
  vi.clearAllMocks();
  settingsMock.mockResolvedValue({ release_messaging: "true", message_body_max_chars: "4000" });
  releasedMock.mockResolvedValue(true);
  threadMessages.current = [];
});

describe("the monthly limit and the throttle in the composer (FR-P3 AC4, AC5)", () => {
  it("answers the upgrade prompt of the organisation at its limit, with the usage and the plan name", async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "send_message") return { data: null, error: { message: "CHARA_LIMIT_REACHED", details: "messages_per_month" } };
      if (name === "get_conversation") return { data: [conversationRow({ organization_id: "org-1" })], error: null };
      if (name === "org_usage") {
        return {
          data: [
            { limit_key: "messages_per_month", used: 100, limit_value: 100, applies: true, period_resets_at: "2027-03-01T00:00:00+00:00", plan_name: "Basic" },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    const result = await sendMessage(CONVERSATION, { body: "Hi" }, "employer");
    expect(result.limitReached).toMatchObject({ limitKey: "messages_per_month", used: 100, limit: 100, planName: "Basic" });
    expect(rpcMock).toHaveBeenCalledWith("org_usage", { p_org: "org-1", p_keys: ["messages_per_month"] });
  });

  it("says the limit in words when the usage cannot be read", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "send_message"
        ? { data: null, error: { message: "CHARA_LIMIT_REACHED", details: "messages_per_month" } }
        : { data: null, error: { message: "CHARA_FORBIDDEN", details: "release_off" } },
    );
    expect(await sendMessage(CONVERSATION, { body: "Hi" }, "recruitment_company")).toEqual({
      message: "Your plan's limit of messages this month is reached.",
    });
  });

  it("asks to wait after the throttle, and reads the page again after a block", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_RATE_LIMITED", details: null } });
    expect((await sendMessage(CONVERSATION, { body: "Hi" })).message).toContain("Wait a minute");
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: "blocked" } });
    expect(await sendMessage(CONVERSATION, { body: "Hi" })).toEqual({ message: "This conversation is closed for new messages.", closed: true });
  });
});

describe("blocking a conversation (FR-P3 AC8)", () => {
  it("blocks and unblocks through the database, and says why a refusal happened", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await setConversationBlocked(CONVERSATION, true, "/en/messages/c")).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("block_conversation", { p_conversation: CONVERSATION });
    expect(await setConversationBlocked(CONVERSATION, false, "/en/messages/c")).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("unblock_conversation", { p_conversation: CONVERSATION });
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: null } });
    expect((await setConversationBlocked(CONVERSATION, false, "/en/messages/c")).message).toBe(
      "Only the person who blocked this conversation can unblock it.",
    );
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: "aal2_required" } });
    await expect(setConversationBlocked(CONVERSATION, true, "/en/org/acme/messages/c")).rejects.toThrow("REDIRECT /en/mfa");
  });

  it("refuses an id that is not one before the database, and everything while the release is off", async () => {
    expect((await setConversationBlocked("nope", true, "/")).message).toBeDefined();
    releasedMock.mockResolvedValue(false);
    expect((await setConversationBlocked(CONVERSATION, true, "/")).message).toBe("Messages are not available at the moment.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("names the blocker only to the blocker", () => {
    expect(readOnlyText({ kind: "worker" }, "blocked", true).title).toBe("You blocked this conversation");
    const other = readOnlyText({ kind: "employer", slug: "acme" }, "blocked");
    expect(other.title).toBe("This conversation is closed for new messages");
    expect(`${other.title} ${other.next}`).not.toMatch(/candidate|employer|blocked by/i);
  });

  it("offers Block on an open conversation and Unblock to the blocker, without a composer", async () => {
    answer({});
    const open = renderToStaticMarkup(
      await ConversationView({ lang: "en", viewer: { kind: "worker" }, conversationId: CONVERSATION, organizationId: null, organization: null, breadcrumb }),
    );
    expect(open).toContain(">Block conversation</button>");
    answer({ conversation: { read_only_reason: "blocked", blocked_by_me: true } });
    const mine = renderToStaticMarkup(
      await ConversationView({ lang: "en", viewer: { kind: "worker" }, conversationId: CONVERSATION, organizationId: null, organization: null, breadcrumb }),
    );
    expect(mine).toContain("Unblock conversation");
    expect(mine).toContain("You blocked this conversation");
    expect(mine).not.toContain("<textarea");
    answer({ conversation: { read_only_reason: "blocked", blocked_by_me: false } });
    const theirs = renderToStaticMarkup(
      await ConversationView({ lang: "en", viewer: { kind: "worker" }, conversationId: CONVERSATION, organizationId: null, organization: null, breadcrumb }),
    );
    expect(theirs).not.toContain("Unblock conversation");
    expect(theirs).not.toContain(">Block conversation</button>");
  });
});

describe("reporting a message and the Workers never pay notice (FR-P3 AC6, AC11)", () => {
  it("is a participant report with its own address and label", () => {
    expect(isParticipantReport("message")).toBe(true);
    expect(isReportItem("message")).toBe(false);
    expect(reportTargetLabels.message).toBe("Message");
    expect(reportPath("en", "message", MESSAGE, "fee_demanded_from_worker")).toBe(
      `/en/report?type=message&message=${MESSAGE}&category=fee_demanded_from_worker`,
    );
  });

  it("offers Report on the messages of others, never on the reader's own", () => {
    threadMessages.current = [message({ id: "m-mine", mine: true, body: "Mine" }), message()];
    const html = renderToStaticMarkup(
      <ConversationThread lang="en" organization={null} conversationId={CONVERSATION} counterpart="Acme Bau" initialMessages={[]} maxChars={4000} />,
    );
    expect(html.match(/>Report<span/g)).toHaveLength(1);
    expect(html).toContain(`href="/en/report?type=message&amp;message=${MESSAGE}"`);
    expect(html).toContain("the message of Mia Member, Acme Bau");
  });

  it("shows the notice and the fee report on the company's last message in a conversation with a candidate", async () => {
    answer({ messages: [messageRow({ id: "55555555-5555-4555-8555-555555555555", mine: true, sender_kind: "worker" }), messageRow()] });
    const html = renderToStaticMarkup(
      await ConversationView({ lang: "en", viewer: { kind: "worker" }, conversationId: CONVERSATION, organizationId: null, organization: null, breadcrumb }),
    );
    expect(html).toContain("Workers never pay fees to get a job through Chara Pinnacle");
    expect(html).toContain(`href="/en/report?type=message&amp;message=${MESSAGE}&amp;category=fee_demanded_from_worker"`);
    expect(html).toContain("Report a fee request");
  });

  it("shows the notice on the company's side too, and none between two organisations", async () => {
    answer({ conversation: { organization_id: "org-1", counterpart_kind: "worker", counterpart_name: "Amina Okafor" } });
    const company = renderToStaticMarkup(
      await ConversationView({
        lang: "en",
        viewer: { kind: "employer", slug: "acme" },
        conversationId: CONVERSATION,
        organizationId: "org-1",
        organization: { id: "org-1", type: "employer", canUpgrade: false, billingHref: "/en/org/acme/billing" },
        breadcrumb,
      }),
    );
    expect(company).toContain("Workers never pay fees");
    answer({ conversation: { organization_id: "org-1", context_type: "partner_response", counterpart_name: "Rekrut" } });
    const partners = renderToStaticMarkup(
      await ConversationView({
        lang: "en",
        viewer: { kind: "employer", slug: "acme" },
        conversationId: CONVERSATION,
        organizationId: "org-1",
        organization: { id: "org-1", type: "employer", canUpgrade: true, billingHref: "/en/org/acme/billing" },
        breadcrumb,
      }),
    );
    expect(partners).not.toContain("Workers never pay");
  });
});
