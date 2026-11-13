import { createLazyClient } from "@/lib/supabase/lazy-browser";

export const UNREAD_CHANGED_EVENT = "chara:notifications-changed";

type Handlers = { onCount: (unread: number) => void; onConnected: (connected: boolean) => void };

// The private Realtime topic of the user (supabase/migrations/20261114100100): the database broadcasts unread_count with
// the new count after every change. supabase-js loads here, on the first signed-in page that shows the bell, never with
// the first load of a page. Answers the function that leaves the channel.
export async function subscribeUnreadCount(userId: string, { onCount, onConnected }: Handlers): Promise<() => void> {
  const supabase = await createLazyClient();
  await supabase.realtime.setAuth();
  const channel = supabase
    .channel(`user:${userId}`, { config: { private: true } })
    .on("broadcast", { event: "unread_count" }, ({ payload }) => {
      const unread: unknown = payload?.unread;
      if (typeof unread === "number") onCount(unread);
    })
    .subscribe((status) => onConnected(status === "SUBSCRIBED"));
  return () => {
    void supabase.removeChannel(channel);
  };
}

// Tells the bell that the page changed the count (an item opened, Mark all as read), for when the channel is not connected.
export function announceUnreadChanged(): void {
  window.dispatchEvent(new Event(UNREAD_CHANGED_EVENT));
}
