"use server";

import * as z from "zod";
import { getUnreadMessageCounts, listMessages } from "@/lib/dal/messaging";
import type { MessageItem, UnreadMessages } from "@/lib/messaging/thread";

const idSchema = z.uuid();

// The newest page of a thread, asked by the open thread after a Realtime signal and while it polls; null when it cannot be
// read (not a participant, the release off, a failed request), and the thread keeps what it shows.
export async function fetchLatestMessages(conversationId: string): Promise<MessageItem[] | null> {
  const id = idSchema.safeParse(conversationId);
  if (!id.success) return null;
  try {
    return await listMessages(id.data);
  } catch {
    return null;
  }
}

// The unread counts behind the messages badge, asked after a signal and while the badge polls; null when they cannot be read.
export async function fetchUnreadMessageCounts(): Promise<UnreadMessages[] | null> {
  try {
    return await getUnreadMessageCounts();
  } catch {
    return null;
  }
}
