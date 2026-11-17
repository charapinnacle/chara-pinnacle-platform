import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpcMock = vi.hoisted(() => vi.fn());
const settingsMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT ${path}`);
  }),
);
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);
const threadMessages = vi.hoisted(() => ({ current: [] as unknown[] }));
const unreadCounts = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));
vi.mock("@/lib/dal/settings", () => ({ getPublicSettings: settingsMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: async () => ({ id: "user-1", accountKind: "company" }) }));
vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
  usePathname: () => "/en/org/acme/applicants/a",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/messaging/hooks", () => ({
  announceMessagesRead: vi.fn(),
  useConversationMessages: () => ({ messages: threadMessages.current, connected: false, refresh: async () => undefined, add: vi.fn() }),
  useUnreadMessages: () => ({ counts: unreadCounts.current, total: 0, connected: false, refresh: async () => undefined }),
}));

const { clampCharacters, messageSchema, parseInboxFilter, parseMessageMaxChars } = await import("@/lib/validation/messaging");
const { contextHref, counterpartLabel, inboxContexts, readOnlyText, senderLabel } = await import("@/lib/messaging/present");
const { conversationPath, messagesPath } = await import("@/lib/routes");
const { openConversation, sendMessage } = await import("@/lib/actions/messaging");
const { ConversationThread } = await import("@/components/messaging/conversation-thread");
const { MessagesInbox } = await import("@/components/messaging/messages-inbox");
const { ConversationView } = await import("@/components/messaging/conversation-view");

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const CONTEXT = "22222222-2222-4222-8222-222222222222";
const REQUIREMENT = "33333333-3333-4333-8333-333333333333";

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    kind: "text",
    body: "Hello",
    createdAt: "2027-02-05T10:00:00.000000+00:00",
    mine: false,
    senderKind: "worker" as const,
    senderName: "Amina Okafor",
    senderOrganizationName: null,
    senderErased: false,
    ...overrides,
  };
}

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION,
    context_type: "application",
    context_id: CONTEXT,
    requirement_id: null,
    organization_id: "org-1",
    counterpart_kind: "worker",
    counterpart_name: "Amina Okafor",
    context_title: "Welder Hamburg",
    last_message_at: "2027-02-05T10:00:00.123456+00:00",
    unread: 2,
    read_only_reason: null,
    blocked_by_me: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsMock.mockResolvedValue({ release_messaging: "true", message_body_max_chars: "4000" });
  releasedMock.mockResolvedValue(true);
  threadMessages.current = [];
  unreadCounts.current = [];
});

describe("the message rules of the composer (FR-P1 AC3, AC10)", () => {
  const schema = messageSchema(4000);

  it("trims, takes CR LF as a line feed and keeps line breaks and tabs", () => {
    expect(schema.parse({ body: " Hello " }).body).toBe("Hello");
    expect(schema.parse({ body: "Line one\r\n\tLine two\r\n" }).body).toBe("Line one\n\tLine two");
  });

  it("refuses an empty, a blank, a too long body and one with a control character", () => {
    for (const body of ["", "      ", "x".repeat(4001), "bell\u0007"]) {
      expect(schema.safeParse({ body }).success, JSON.stringify(body.slice(0, 10))).toBe(false);
    }
    expect(schema.safeParse({ body: "x".repeat(4000) }).success).toBe(true);
    expect(schema.safeParse({ body: "😀".repeat(4000) }).success).toBe(true);
  });

  it("takes no character past the limit, counting as the database does", () => {
    expect(clampCharacters("x".repeat(4001), 4000)).toHaveLength(4000);
    expect(Array.from(clampCharacters("😀".repeat(4001), 4000))).toHaveLength(4000);
    expect(clampCharacters("short", 4000)).toBe("short");
  });

  it("reads the length setting within the check's bound", () => {
    expect(parseMessageMaxChars("2000")).toBe(2000);
    for (const value of [undefined, "", "0", "4001", "12.5", "abc"]) expect(parseMessageMaxChars(value)).toBe(4000);
  });

  it("reads the inbox filter from the address", () => {
    expect(parseInboxFilter("partner_response")).toBe("partner_response");
    for (const value of [undefined, "", "inquiry", ["application"]]) expect(parseInboxFilter(value)).toBeNull();
  });
});

describe("the addresses and labels of the pages (FR-P1 AC11)", () => {
  const summary = {
    id: CONVERSATION,
    contextType: "application" as const,
    contextId: CONTEXT,
    requirementId: REQUIREMENT,
    counterpartKind: "worker" as const,
    counterpartName: null,
    contextTitle: null,
    lastMessageAt: "2027-02-05T10:00:00Z",
    unread: 0,
    readOnlyReason: null,
  };

  it("addresses the inbox and a conversation of the candidate and of an organisation", () => {
    expect(messagesPath("en", null)).toBe("/en/messages");
    expect(messagesPath("en", "acme", { context: "application", before: "2027-02-05T10:00:00+00:00|x" })).toBe(
      "/en/org/acme/messages?context=application&before=2027-02-05T10%3A00%3A00%2B00%3A00%7Cx",
    );
    expect(conversationPath("en", "acme", CONVERSATION)).toBe(`/en/org/acme/messages/${CONVERSATION}`);
    expect(conversationPath("en", null, CONVERSATION)).toBe(`/en/messages/${CONVERSATION}`);
  });

  it("links each context to its page from each side", () => {
    const employer = { kind: "employer", slug: "acme" } as const;
    const partner = { kind: "partner", slug: "rekrut" } as const;
    const worker = { kind: "worker" } as const;
    expect(contextHref("en", employer, summary)).toBe(`/en/org/acme/applicants/${CONTEXT}`);
    expect(contextHref("en", worker, summary)).toBe(`/en/applications/${CONTEXT}`);
    expect(contextHref("en", employer, { ...summary, contextType: "candidate_submission" })).toBe(`/en/org/acme/applicants/submissions/${CONTEXT}`);
    expect(contextHref("en", worker, { ...summary, contextType: "candidate_submission" })).toBe(`/en/submissions/${CONTEXT}`);
    expect(contextHref("en", employer, { ...summary, contextType: "requirement_invitation" })).toBe(`/en/org/acme/requirements/${REQUIREMENT}`);
    expect(contextHref("en", partner, { ...summary, contextType: "requirement_invitation" })).toBe(`/en/org/rekrut/invitations/${CONTEXT}`);
    expect(contextHref("en", employer, { ...summary, contextType: "partner_response" })).toBe(
      `/en/org/acme/requirements/${REQUIREMENT}/responses/${CONTEXT}`,
    );
    expect(contextHref("en", partner, { ...summary, contextType: "partner_response" })).toBe(`/en/org/rekrut/responses/${CONTEXT}`);
    expect(contextHref("en", employer, { ...summary, contextType: "inquiry" })).toBeNull();
  });

  it("offers each side the filters of its contexts", () => {
    expect(inboxContexts({ kind: "worker" })).toEqual(["application", "candidate_submission"]);
    expect(inboxContexts({ kind: "partner", slug: "r" })).toEqual(["requirement_invitation", "partner_response"]);
    expect(inboxContexts({ kind: "employer", slug: "a" })).toHaveLength(4);
  });

  it("names the other party and the sender, never more than the database answered (NFR-S11)", () => {
    expect(counterpartLabel({ counterpartKind: "worker", counterpartName: null })).toBe("Former candidate");
    expect(counterpartLabel({ counterpartKind: "organization", counterpartName: null })).toBe("Company not named");
    expect(counterpartLabel({ counterpartKind: "organization", counterpartName: "Acme Bau" })).toBe("Acme Bau");
    expect(senderLabel(message({ mine: true }))).toBe("You");
    expect(senderLabel(message())).toBe("Amina Okafor");
    expect(senderLabel(message({ senderErased: true, senderName: null }))).toBe("Deleted user");
    const member = { senderKind: "organization", senderName: "Mia Member", senderOrganizationName: "Acme Bau" };
    expect(senderLabel(message(member))).toBe("Mia Member, Acme Bau");
    expect(senderLabel(message({ ...member, senderErased: true, senderName: null }))).toBe("Former member, Acme Bau");
    expect(senderLabel(message({ ...member, senderName: null, senderOrganizationName: null }))).toBe("Company not named");
  });

  it("says why a conversation is closed and what comes next (NFR-U4)", () => {
    expect(readOnlyText({ kind: "worker" }, "context_closed").next).toContain("Apply again");
    expect(readOnlyText({ kind: "employer", slug: "a" }, "context_closed").next).toContain("read the history");
    expect(readOnlyText({ kind: "employer", slug: "a" }, "org_suspended").next).toContain("reinstated");
  });
});

describe("the thread renders text only (FR-P1 AC9, NFR-S10)", () => {
  it("shows markup and addresses literally, with the line breaks, in a log region", () => {
    threadMessages.current = [
      message({ id: "m-2", body: "see https://example.com", createdAt: "2027-02-05T10:01:00.000000+00:00" }),
      message({ id: "m-1", body: "<img src=x onerror=alert(1)>\nsecond line" }),
    ];
    const html = renderToStaticMarkup(
      <ConversationThread lang="en" organization={null} conversationId={CONVERSATION} counterpart="Amina Okafor" initialMessages={[]} maxChars={4000} />,
    );
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;\nsecond line");
    expect(html).not.toContain("<img");
    expect(html).toContain("see https://example.com");
    expect(html).not.toMatch(/<a [^>]*example\.com/);
    expect(html).toMatch(/role="log"[^>]*aria-label="Messages with Amina Okafor"|aria-label="Messages with Amina Okafor"[^>]*role="log"/);
    expect(html.indexOf("&lt;img")).toBeLessThan(html.indexOf("see https"));
    expect(html).toContain("whitespace-pre-wrap");
  });

  it("offers a plain-text composer named for the other party, with the counter and no attachment control (AC10)", () => {
    const html = renderToStaticMarkup(
      <ConversationThread lang="en" organization={null} conversationId={CONVERSATION} counterpart="Amina Okafor" initialMessages={[]} maxChars={4000} />,
    );
    expect(html).toMatch(/<label[^>]*for="message-body"[^>]*>Message to Amina Okafor<\/label>/);
    expect(html).toContain("0 / 4,000 characters");
    expect(html).not.toContain('type="file"');
    expect(html).toContain("No messages yet");
  });

  it("replaces the composer with the closed state while nobody can send", () => {
    const html = renderToStaticMarkup(
      <ConversationThread lang="en" organization={null} conversationId={CONVERSATION} counterpart="Amina Okafor" initialMessages={[]} maxChars={null}>
        [closed]
      </ConversationThread>,
    );
    expect(html).toContain("[closed]");
    expect(html).not.toContain("<textarea");
  });

  it("offers earlier messages when the first page is full", () => {
    const page = Array.from({ length: 50 }, (_, index) => message({ id: `m-${index}` }));
    threadMessages.current = page;
    const html = renderToStaticMarkup(
      <ConversationThread lang="en" organization={null} conversationId={CONVERSATION} counterpart="Amina Okafor" initialMessages={page} maxChars={4000} />,
    );
    expect(html).toContain("Show earlier messages");
  });
});

describe("the inbox (FR-P1 AC10)", () => {
  const searchParams = {};

  async function inboxHtml(props: Partial<Parameters<typeof MessagesInbox>[0]> = {}) {
    const element = MessagesInbox({ lang: "en", viewer: { kind: "worker" }, userId: "user-1", organizationId: null, searchParams, ...props });
    const child = element.props.children[2].props.children;
    return renderToStaticMarkup(await child.type(child.props));
  }

  it("lists the conversations with the context, the unread count and the link, and the filters of the side", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "list_conversations"
        ? { data: [conversationRow()], error: null }
        : { data: [{ conversation_id: CONVERSATION, organization_id: "org-1", unread: 2 }], error: null },
    );
    unreadCounts.current = [{ conversationId: CONVERSATION, organizationId: "org-1", unread: 2 }];
    const props = { viewer: { kind: "employer", slug: "acme" } as const, organizationId: "org-1" };
    const page = renderToStaticMarkup(MessagesInbox({ lang: "en", userId: "user-1", searchParams, ...props }));
    expect(page).toContain('aria-label="Filter by context"');
    for (const label of ["All", "Applications", "Submissions", "Invitations", "Responses"]) expect(page).toContain(`>${label}</a>`);
    const list = await inboxHtml(props);
    expect(list).toContain(`href="/en/org/acme/messages/${CONVERSATION}"`);
    expect(list).toContain("Amina Okafor");
    expect(list).toContain(", 2 unread");
    expect(list).toContain("Welder Hamburg");
    expect(rpcMock).toHaveBeenCalledWith("list_conversations", expect.objectContaining({ p_org: "org-1", p_limit: 21 }));
  });

  it("says when conversations start when there are none, and offers all when a filter finds none", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const empty = await inboxHtml();
    expect(empty).toContain("No conversations yet");
    expect(empty).toContain("A conversation starts when an employer writes to you");
    const filtered = await inboxHtml({ searchParams: { context: "application" } });
    expect(filtered).toContain("No conversations about applications");
    expect(filtered).toContain('href="/en/messages"');
    expect(rpcMock).toHaveBeenCalledWith("list_conversations", expect.objectContaining({ p_context_type: "application", p_org: undefined }));
  });

  it("pages with the last row's time and id, and passes a cursor on", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "list_conversations"
        ? { data: Array.from({ length: 21 }, (_, index) => conversationRow({ id: `${CONVERSATION.slice(0, -2)}${String(index).padStart(2, "0")}` })), error: null }
        : { data: [], error: null },
    );
    const html = await inboxHtml();
    expect(html).toContain("Older conversations");
    expect(html).toContain(`before=${encodeURIComponent(`2027-02-05T10:00:00.123456+00:00|${CONVERSATION.slice(0, -2)}19`)}`);
    await inboxHtml({ searchParams: { before: `2027-02-05T10:00:00.123456+00:00|${CONVERSATION}` } });
    expect(rpcMock).toHaveBeenCalledWith(
      "list_conversations",
      expect.objectContaining({ p_before_at: "2027-02-05T10:00:00.123456+00:00", p_before_id: CONVERSATION }),
    );
  });

  it("lets a failed read reach the error boundary, which offers a retry", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(inboxHtml()).rejects.toThrow("could not be loaded");
  });
});

describe("the conversation page (FR-P1 AC11, NFR-U4)", () => {
  const breadcrumb = (counterpart: string) => <p>crumb {counterpart}</p>;

  it("names the other party and the context, links its page and offers the composer", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "get_conversation" ? { data: [conversationRow()], error: null } : { data: [], error: null },
    );
    const html = renderToStaticMarkup(
      await ConversationView({ lang: "en", viewer: { kind: "employer", slug: "acme" }, conversationId: CONVERSATION, organizationId: "org-1", organization: null, breadcrumb }),
    );
    expect(html).toContain("<h1");
    expect(html).toContain("Amina Okafor");
    expect(html).toContain("Application: Welder Hamburg");
    expect(html).toContain(`href="/en/org/acme/applicants/${CONTEXT}"`);
    expect(html).toContain("Open the application");
    expect(html).toContain("Message to Amina Okafor");
  });

  it("shows why a closed conversation takes no messages, and no composer", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "get_conversation" ? { data: [conversationRow({ read_only_reason: "context_closed" })], error: null } : { data: [], error: null },
    );
    const html = renderToStaticMarkup(
      await ConversationView({ lang: "en", viewer: { kind: "employer", slug: "acme" }, conversationId: CONVERSATION, organizationId: "org-1", organization: null, breadcrumb }),
    );
    expect(html).toContain("This conversation is closed for new messages");
    expect(html).not.toContain("<textarea");
  });

  it("answers a conversation of another side, and one the caller takes no part in, as not found", async () => {
    rpcMock.mockResolvedValue({ data: [conversationRow()], error: null });
    await expect(
      ConversationView({ lang: "en", viewer: { kind: "worker" }, conversationId: CONVERSATION, organizationId: null, organization: null, breadcrumb }),
    ).rejects.toThrow("NOT_FOUND");
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: null } });
    await expect(
      ConversationView({ lang: "en", viewer: { kind: "employer", slug: "acme" }, conversationId: CONVERSATION, organizationId: "org-1", organization: null, breadcrumb }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("the actions (FR-P1 AC3, AC6; SOP P2-26 steps Open, Send)", () => {
  it("sends the trimmed body, and refuses an invalid one before the database", async () => {
    rpcMock.mockResolvedValue({ data: [{ id: "m", created_at: "x" }], error: null });
    expect(await sendMessage(CONVERSATION, { body: "  Hello \r\n there " })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("send_message", { p_conversation: CONVERSATION, p_body: "Hello \n there" });
    rpcMock.mockClear();
    expect((await sendMessage(CONVERSATION, { body: "   " })).errors?.body).toBe("Write a message.");
    expect(await sendMessage("not-a-uuid", { body: "Hi" })).toEqual({ message: expect.any(String) });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("follows a lowered length setting", async () => {
    settingsMock.mockResolvedValue({ release_messaging: "true", message_body_max_chars: "10" });
    expect((await sendMessage(CONVERSATION, { body: "x".repeat(11) })).errors?.body).toBe("A message has at most 10 characters.");
  });

  it("says why the database refused, and marks a closed conversation so the page reads it again", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: "context_closed" } });
    expect(await sendMessage(CONVERSATION, { body: "Hi" })).toEqual({ message: "This conversation is closed for new messages.", closed: true });
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: "org_suspended" } });
    expect((await sendMessage(CONVERSATION, { body: "Hi" })).closed).toBe(true);
    settingsMock.mockResolvedValue({ release_messaging: "false" });
    rpcMock.mockClear();
    expect(await sendMessage(CONVERSATION, { body: "Hi" })).toEqual({ message: "Messages are not available at the moment." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("opens the conversation of a context and goes to it in the organisation or as the candidate", async () => {
    rpcMock.mockResolvedValue({ data: CONVERSATION, error: null });
    await expect(openConversation({ contextType: "application", contextId: CONTEXT, slug: "acme" }, "/en/org/acme/applicants/a")).rejects.toThrow(
      `REDIRECT /en/org/acme/messages/${CONVERSATION}`,
    );
    expect(rpcMock).toHaveBeenCalledWith("open_conversation", { p_context_type: "application", p_context_id: CONTEXT });
    await expect(openConversation({ contextType: "application", contextId: CONTEXT, slug: null }, "/en/applications/a")).rejects.toThrow(
      `REDIRECT /en/messages/${CONVERSATION}`,
    );
  });

  it("sends an owner or admin at aal1 to two-step verification and back, and refuses what the database refuses", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: "aal2_required" } });
    await expect(openConversation({ contextType: "partner_response", contextId: CONTEXT, slug: "rekrut" }, "/en/org/rekrut/responses/r")).rejects.toThrow(
      `REDIRECT /en/mfa?next=${encodeURIComponent("/en/org/rekrut/responses/r")}`,
    );
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: "context_closed" } });
    expect(await openConversation({ contextType: "application", contextId: CONTEXT, slug: "acme" }, "/x")).toEqual({
      message: "A conversation cannot be started here any more.",
    });
    rpcMock.mockClear();
    expect(await openConversation({ contextType: "inquiry", contextId: CONTEXT, slug: "acme" }, "/x")).toEqual({ message: expect.any(String) });
    releasedMock.mockResolvedValue(false);
    expect(await openConversation({ contextType: "application", contextId: CONTEXT, slug: "acme" }, "/x")).toEqual({
      message: "Messages are not available at the moment.",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
