import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Broadcast = { event: string; payload: unknown };
type FakeChannel = {
  name: string;
  options: unknown;
  emit: (message: Broadcast) => void;
  status: (status: string) => void;
};

const channels = vi.hoisted(() => [] as FakeChannel[]);
const removed = vi.hoisted(() => [] as string[]);
const setAuthMock = vi.hoisted(() => vi.fn(async () => undefined));
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/lazy-browser", () => ({
  createLazyClient: async () => ({
    realtime: { setAuth: setAuthMock },
    channel: (name: string, options: unknown) => {
      const channel: FakeChannel = { name, options, emit: () => undefined, status: () => undefined };
      channels.push(channel);
      const builder = {
        on: (_type: string, filter: { event: string }, callback: (message: Broadcast) => void) => {
          expect(filter.event).toBe("*");
          channel.emit = callback;
          return builder;
        },
        subscribe: (callback: (status: string) => void) => {
          channel.status = callback;
          return channel;
        },
      };
      return builder;
    },
    removeChannel: async (channel: FakeChannel) => {
      removed.push(channel.name);
      return "ok";
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { listenOnTopic } = await import("@/lib/realtime/topic");
const { subscribeUnreadCount } = await import("@/lib/notifications/unread-channel");
const { followLive, subscribeConversation, subscribeUnreadMessages } = await import("@/lib/messaging/live");
const { mergeLatest, mergeMessages, totalUnread } = await import("@/lib/messaging/thread");
const { fetchLatestMessages, fetchUnreadMessageCounts } = await import("@/lib/actions/messaging");

const CONVERSATION = "11111111-1111-4111-8111-111111111111";

function message(id: string, createdAt: string) {
  return {
    id,
    kind: "text",
    body: `Body ${id}`,
    createdAt,
    mine: false,
    senderKind: "worker" as const,
    senderName: "Amina Okafor",
    senderOrganizationName: null,
    senderErased: false,
    hiddenBy: null,
  };
}

function lastChannel(name: string): FakeChannel {
  const channel = channels.filter((c) => c.name === name).at(-1);
  if (!channel) throw new Error(`no channel ${name}`);
  return channel;
}

beforeEach(() => {
  vi.clearAllMocks();
  channels.length = 0;
  removed.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("one private channel per topic (FR-P1 AC8, FR-P4 AC1)", () => {
  it("shares the user topic between the notification count and the message signals", async () => {
    const onCount = vi.fn();
    const onMessages = vi.fn();
    const bellConnected = vi.fn();
    const leaveBell = await subscribeUnreadCount("u-1", { onCount, onConnected: bellConnected });
    const leaveMessages = await subscribeUnreadMessages("u-1", { onSignal: onMessages, onConnected: vi.fn() });

    expect(channels.map((c) => c.name)).toEqual(["user:u-1"]);
    expect(channels[0].options).toEqual({ config: { private: true } });
    expect(setAuthMock).toHaveBeenCalledTimes(1);

    const channel = lastChannel("user:u-1");
    channel.emit({ event: "unread_count", payload: { unread: 4 } });
    channel.emit({ event: "unread_count", payload: { unread: "4" } });
    channel.emit({ event: "messages_unread", payload: { conversation_id: CONVERSATION } });
    channel.emit({ event: "messages_unread", payload: null });
    expect(onCount.mock.calls).toEqual([[4]]);
    expect(onMessages).toHaveBeenCalledTimes(1);

    leaveBell();
    expect(removed).toEqual([]);
    leaveMessages();
    await Promise.resolve();
    expect(removed).toEqual(["user:u-1"]);
  });

  it("reports the channel state to every listener, also to one that joins after the channel connected", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const leaveFirst = await subscribeConversation(CONVERSATION, { onSignal: vi.fn(), onConnected: first });
    lastChannel(`conversation:${CONVERSATION}`).status("SUBSCRIBED");
    const leaveSecond = await subscribeConversation(CONVERSATION, { onSignal: vi.fn(), onConnected: second });
    expect(first.mock.calls).toEqual([[true]]);
    expect(second.mock.calls).toEqual([[true]]);

    lastChannel(`conversation:${CONVERSATION}`).status("CHANNEL_ERROR");
    expect(first.mock.calls.at(-1)).toEqual([false]);
    expect(second.mock.calls.at(-1)).toEqual([false]);
    leaveFirst();
    leaveFirst();
    leaveSecond();
    await Promise.resolve();
    expect(removed).toEqual([`conversation:${CONVERSATION}`]);
  });

  it("joins the topic again after its last listener left", async () => {
    const leave = await listenOnTopic("conversation:again", { event: "message", onPayload: vi.fn(), onConnected: vi.fn() });
    leave();
    await listenOnTopic("conversation:again", { event: "message", onPayload: vi.fn(), onConnected: vi.fn() });
    expect(channels.filter((c) => c.name === "conversation:again")).toHaveLength(2);
  });

  it("passes only the message event of the conversation topic to the thread", async () => {
    const onSignal = vi.fn();
    await subscribeConversation("conv-events", { onSignal, onConnected: vi.fn() });
    const channel = lastChannel("conversation:conv-events");
    channel.emit({ event: "message", payload: { id: "m-1", created_at: "2027-02-04T10:00:00+00:00" } });
    channel.emit({ event: "messages_unread", payload: {} });
    expect(onSignal).toHaveBeenCalledTimes(1);
  });

  it("forgets a topic whose join failed, so the next listener tries again", async () => {
    setAuthMock.mockRejectedValueOnce(new Error("offline"));
    await expect(listenOnTopic("user:fails", { event: "x", onPayload: vi.fn(), onConnected: vi.fn() })).rejects.toThrow("offline");
    await listenOnTopic("user:fails", { event: "x", onPayload: vi.fn(), onConnected: vi.fn() });
    expect(channels.filter((c) => c.name === "user:fails")).toHaveLength(1);
  });
});

describe("followLive: signals, and polling while not connected (FR-P1 AC8, NFR-P4)", () => {
  function source() {
    let handlers: { onSignal: () => void; onConnected: (connected: boolean) => void } | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(async (h: { onSignal: () => void; onConnected: (connected: boolean) => void }) => {
      handlers = h;
      return unsubscribe;
    });
    return {
      subscribe,
      unsubscribe,
      signal: () => handlers?.onSignal(),
      connect: (connected: boolean) => handlers?.onConnected(connected),
    };
  }

  it("polls every pollMs until the channel connects, then refreshes on signals only", async () => {
    vi.useFakeTimers();
    const live = source();
    const refresh = vi.fn(async () => undefined);
    const onConnected = vi.fn();
    const stop = followLive({ subscribe: live.subscribe, refresh, pollMs: 4_000, onConnected });

    await vi.advanceTimersByTimeAsync(12_000);
    expect(refresh).toHaveBeenCalledTimes(3);

    live.connect(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(onConnected).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh).toHaveBeenCalledTimes(4);

    live.signal();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(5);
    stop();
  });

  it("falls back to polling when the connection is cut, and catches up once it is back", async () => {
    vi.useFakeTimers();
    const live = source();
    const refresh = vi.fn(async () => undefined);
    const stop = followLive({ subscribe: live.subscribe, refresh, pollMs: 4_000 });
    await vi.advanceTimersByTimeAsync(0);
    live.connect(true);
    await vi.advanceTimersByTimeAsync(0);
    refresh.mockClear();

    live.connect(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(7);

    live.connect(true);
    live.connect(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(8);
    stop();
  });

  it("runs one refresh at a time and one more for the signals that came meanwhile", async () => {
    vi.useFakeTimers();
    const live = source();
    let finish: () => void = () => undefined;
    const refresh = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const stop = followLive({ subscribe: live.subscribe, refresh, pollMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    live.connect(true);
    live.signal();
    live.signal();
    live.signal();
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps polling after a failed refresh and when the channel cannot be joined", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => {
      throw new Error("network");
    });
    const onConnected = vi.fn();
    const stop = followLive({ subscribe: async () => Promise.reject(new Error("refused")), refresh, pollMs: 4_000, onConnected });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onConnected).toHaveBeenCalledWith(false);
    stop();
  });

  it("stops polling and leaves the channel when stopped, also before the join finished", async () => {
    vi.useFakeTimers();
    const live = source();
    const refresh = vi.fn(async () => undefined);
    const stop = followLive({ subscribe: live.subscribe, refresh, pollMs: 4_000 });
    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(live.unsubscribe).toHaveBeenCalledTimes(1);
    live.signal();
    live.connect(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the thread in the browser", () => {
  it("merges by id, newest first, ordered to the microsecond", () => {
    const merged = mergeMessages(
      [message("b", "2027-02-04T10:00:00.12345+00:00"), message("a", "2027-02-04T10:00:00+00:00")],
      [message("c", "2027-02-04T10:00:00.123451+00:00"), { ...message("b", "2027-02-04T10:00:00.12345+00:00"), body: "Edited" }],
    );
    expect(merged.map((m) => m.id)).toEqual(["c", "b", "a"]);
    expect(merged[1].body).toBe("Edited");
  });

  it("orders messages of the same time by id, as list_messages", () => {
    const at = "2027-02-04T10:00:00+00:00";
    expect(mergeMessages([message("1", at)], [message("2", at)]).map((m) => m.id)).toEqual(["2", "1"]);
  });

  it("adds the newest page to what is held", () => {
    const held = [message("2", "2027-02-04T10:02:00+00:00"), message("1", "2027-02-04T10:01:00+00:00")];
    const page = [message("3", "2027-02-04T10:03:00+00:00"), message("2", "2027-02-04T10:02:00+00:00")];
    expect(mergeLatest(held, page, 2).map((m) => m.id)).toEqual(["3", "2", "1"]);
  });

  it("replaces what is held with a full page that does not reach it, rather than leave a gap", () => {
    const held = [message("1", "2027-02-04T10:01:00+00:00")];
    const page = [message("3", "2027-02-04T10:03:00+00:00"), message("2", "2027-02-04T10:02:00+00:00")];
    expect(mergeLatest(held, page, 2).map((m) => m.id)).toEqual(["3", "2"]);
    expect(mergeLatest(held, page, 3).map((m) => m.id)).toEqual(["3", "2", "1"]);
  });

  it("totals the unread counts", () => {
    expect(totalUnread([])).toBe(0);
    expect(
      totalUnread([
        { conversationId: "c1", organizationId: "o1", unread: 3 },
        { conversationId: "c2", organizationId: null, unread: 1 },
      ]),
    ).toBe(4);
  });
});

describe("the reads behind the hooks", () => {
  it("asks list_messages for the newest page and maps the rows", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: "m-1",
          kind: "text",
          body: "Can I start in March?",
          created_at: "2027-02-04T10:00:00+00:00",
          mine: false,
          sender_kind: "worker",
          sender_name: null,
          sender_organization_name: null,
          sender_erased: false,
        },
      ],
      error: null,
    });
    expect(await fetchLatestMessages(CONVERSATION)).toEqual([
      {
        id: "m-1",
        kind: "text",
        body: "Can I start in March?",
        createdAt: "2027-02-04T10:00:00+00:00",
        mine: false,
        senderKind: "worker",
        senderName: null,
        senderOrganizationName: null,
        senderErased: false,
        hiddenBy: null,
      },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("list_messages", {
      p_conversation: CONVERSATION,
      p_before_at: undefined,
      p_before_id: undefined,
      p_limit: 50,
    });
  });

  it("asks nothing for an id that is no uuid, and answers null when the database refuses", async () => {
    expect(await fetchLatestMessages("conversation:x")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "CHARA_FORBIDDEN", details: "" } });
    expect(await fetchLatestMessages(CONVERSATION)).toBeNull();
    expect(await fetchUnreadMessageCounts()).toBeNull();
  });

  it("maps my_unread_counts", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { conversation_id: "c1", organization_id: "o1", unread: 3 },
        { conversation_id: "c2", organization_id: null, unread: 1 },
      ],
      error: null,
    });
    expect(await fetchUnreadMessageCounts()).toEqual([
      { conversationId: "c1", organizationId: "o1", unread: 3 },
      { conversationId: "c2", organizationId: null, unread: 1 },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("my_unread_counts");
  });
});
