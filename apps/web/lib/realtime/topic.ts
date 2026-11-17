import { createLazyClient } from "@/lib/supabase/lazy-browser";

export type TopicListener = {
  event: string;
  onPayload: (payload: Record<string, unknown>) => void;
  onConnected: (connected: boolean) => void;
};

type Listeners = { listeners: Set<TopicListener>; connected: boolean };
type Topic = Listeners & { leave: Promise<() => void> };

const topics = new Map<string, Topic>();

async function join(name: string, topic: Listeners): Promise<() => void> {
  const supabase = await createLazyClient();
  await supabase.realtime.setAuth();
  const channel = supabase
    .channel(name, { config: { private: true } })
    .on("broadcast", { event: "*" }, (message) => {
      const payload: unknown = message.payload;
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return;
      for (const listener of topic.listeners) {
        if (listener.event === message.event) listener.onPayload(payload as Record<string, unknown>);
      }
    })
    .subscribe((status) => {
      topic.connected = status === "SUBSCRIBED";
      for (const listener of topic.listeners) listener.onConnected(topic.connected);
    });
  return () => {
    void supabase.removeChannel(channel);
  };
}

// One private channel per topic for the whole page: supabase-js answers the channel it already made for a topic, so a
// second subscribe, or the removeChannel of one listener, would act on the channel of every other listener too. The
// channel is left when its last listener leaves. Answers the function that removes this listener.
export async function listenOnTopic(name: string, listener: TopicListener): Promise<() => void> {
  let topic = topics.get(name);
  if (!topic) {
    const state: Listeners = { listeners: new Set(), connected: false };
    topic = Object.assign(state, { leave: join(name, state) });
    topics.set(name, topic);
  }
  topic.listeners.add(listener);
  if (topic.connected) listener.onConnected(true);
  const current = topic;
  try {
    await current.leave;
  } catch (error) {
    current.listeners.delete(listener);
    if (topics.get(name) === current) topics.delete(name);
    throw error;
  }
  return () => {
    if (!current.listeners.delete(listener) || current.listeners.size > 0) return;
    if (topics.get(name) === current) topics.delete(name);
    void current.leave.then((leave) => leave());
  };
}
