"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { getUnreadMessageCounts, listMessages } from "@/lib/dal/messaging";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { getPublicSettings } from "@/lib/dal/settings";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import type { MessageItem, UnreadMessages } from "@/lib/messaging/thread";
import { conversationPath, mfaPath } from "@/lib/routes";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { messageSchema, openConversationSchema, parseMessageMaxChars, type MessageInput } from "@/lib/validation/messaging";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

const idSchema = z.uuid();

const RELEASE_OFF = "Messages are not available at the moment.";

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

// The page of a thread before the message `before`, asked by "Show earlier messages"; null when it cannot be read.
export async function fetchEarlierMessages(conversationId: string, before: { at: string; id: string }): Promise<MessageItem[] | null> {
  const id = idSchema.safeParse(conversationId);
  const beforeId = idSchema.safeParse(before.id);
  const beforeAt = z.iso.datetime({ offset: true }).safeParse(before.at);
  if (!id.success || !beforeId.success || !beforeAt.success) return null;
  try {
    return await listMessages(id.data, { at: beforeAt.data, id: beforeId.data });
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

export type SendMessageResult = { errors?: FieldErrors; message?: string; done?: true; closed?: true };

const SEND_REFUSALS: Record<string, SendMessageResult> = {
  "CHARA_FORBIDDEN:context_closed": { message: "This conversation is closed for new messages.", closed: true },
  "CHARA_FORBIDDEN:org_suspended": {
    message: "No new messages can be sent while an organisation in this conversation is suspended.",
    closed: true,
  },
  "CHARA_FORBIDDEN:release_off": { message: RELEASE_OFF },
  "CHARA_FORBIDDEN:aal2_required": { message: "Confirm two-step verification again, then send the message." },
  "CHARA_FORBIDDEN:": { message: "You can no longer send messages in this conversation." },
};

// Sends a plain-text message (FR-P1 AC3, AC9; SOP P2-26 step Send; NFR-S10). The form's rule is checked again here and the
// database stays the authority: the participant, the length setting, the text rules and whether the context still allows
// contact. The body is never logged.
export async function sendMessage(conversationId: string, input: MessageInput): Promise<SendMessageResult> {
  const id = idSchema.safeParse(conversationId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const settings = await getPublicSettings();
  const parsed = messageSchema(parseMessageMaxChars(settings.message_body_max_chars)).safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (settings.release_messaging !== "true") return { message: RELEASE_OFF };
  await requireUser(defaultLocale);

  const { error } = await (await createClient()).rpc("send_message", { p_conversation: id.data, p_body: parsed.data.body });
  if (!error) return { done: true };
  if (error.message === "CHARA_INVALID_INPUT") return { errors: { body: "Check the message: it is empty, too long or has special characters." } };
  const known = SEND_REFUSALS[`${error.message}:${error.details ?? ""}`];
  return known ?? { message: faultMessage(logFault("Sending a message", error)) };
}

// Marks the thread read for the caller up to now (FR-P1 AC7, SOP step Read). A failure leaves it unread and says nothing:
// the next open, or the next message shown, marks it again.
export async function markConversationRead(conversationId: string): Promise<boolean> {
  const id = idSchema.safeParse(conversationId);
  if (!id.success) return false;
  const { error } = await (await createClient()).rpc("mark_conversation_read", { p_conversation: id.data });
  return !error;
}

export type OpenConversationResult = { message?: string };

const OPEN_REFUSALS: Record<string, string> = {
  "CHARA_FORBIDDEN:context_closed": "A conversation cannot be started here any more.",
  "CHARA_FORBIDDEN:org_suspended": "No conversation can be started while an organisation is suspended.",
  "CHARA_FORBIDDEN:release_off": RELEASE_OFF,
  "CHARA_FORBIDDEN:": "You cannot start a conversation here.",
};

// The "Message" button of a context page (SOP P2-26 step Open): opens the one conversation of the context, or answers the
// one already open, and goes to it, in the organisation slug or as the candidate. returnTo is the page of the button, where
// an owner or admin comes back after confirming two-step verification.
export async function openConversation(
  input: { contextType: string; contextId: string; slug: string | null },
  returnTo: string,
): Promise<OpenConversationResult> {
  const parsed = openConversationSchema.safeParse(input);
  if (!parsed.success) return { message: GENERIC_FAILURE };
  const { contextType, contextId, slug } = parsed.data;
  if (!(await isReleased("release_messaging"))) return { message: RELEASE_OFF };
  await requireUser(defaultLocale);

  const { data, error } = await (await createClient()).rpc("open_conversation", { p_context_type: contextType, p_context_id: contextId });
  if (error) {
    if (error.message === "CHARA_FORBIDDEN" && error.details === "aal2_required") redirect(mfaPath(defaultLocale, safeNextPath(returnTo)));
    return { message: OPEN_REFUSALS[`${error.message}:${error.details ?? ""}`] ?? faultMessage(logFault("Opening a conversation", error)) };
  }
  redirect(conversationPath(defaultLocale, slug, data));
}
