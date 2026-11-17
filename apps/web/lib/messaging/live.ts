import { listenOnTopic } from "@/lib/realtime/topic";

type SignalHandlers = { onSignal: () => void; onConnected: (connected: boolean) => void };

export type LiveSource = {
  subscribe: (handlers: SignalHandlers) => Promise<() => void>;
  refresh: () => Promise<void>;
  pollMs: number;
  onConnected?: (connected: boolean) => void;
};

// Refreshes on every signal of the topic, and once more when the channel (re)connects for what came while it was not.
// While the channel is not connected (no Realtime service, a cut connection, a refused join) it refreshes every pollMs
// instead. One refresh runs at a time; signals during it ask for one more, not one each. Answers the function that stops.
export function followLive({ subscribe, refresh, pollMs, onConnected }: LiveSource): () => void {
  let stopped = false;
  let connected = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let leave: (() => void) | undefined;

  async function run(): Promise<void> {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await refresh();
    } catch {
      // A failed request is asked again by the next signal or poll.
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      await run();
    }
  }

  function poll(): void {
    clearInterval(timer);
    timer = connected || stopped ? undefined : setInterval(() => void run(), pollMs);
  }

  function setConnected(next: boolean): void {
    if (stopped) return;
    const reconnected = next && !connected;
    connected = next;
    poll();
    onConnected?.(next);
    if (reconnected) void run();
  }

  poll();
  subscribe({ onSignal: () => void run(), onConnected: setConnected })
    .then((unsubscribe) => {
      if (stopped) unsubscribe();
      else leave = unsubscribe;
    })
    .catch(() => setConnected(false));

  return () => {
    stopped = true;
    poll();
    leave?.();
  };
}

// conversation:<id> (supabase/migrations/20270204100000): a message signal per new message; the body is read through
// list_messages.
export function subscribeConversation(conversationId: string, { onSignal, onConnected }: SignalHandlers): Promise<() => void> {
  return listenOnTopic(`conversation:${conversationId}`, { event: "message", onPayload: onSignal, onConnected });
}

// user:<id>: messages_unread after a message to the user and after the user read a conversation; the counts are read
// through my_unread_counts.
export function subscribeUnreadMessages(userId: string, { onSignal, onConnected }: SignalHandlers): Promise<() => void> {
  return listenOnTopic(`user:${userId}`, { event: "messages_unread", onPayload: onSignal, onConnected });
}
