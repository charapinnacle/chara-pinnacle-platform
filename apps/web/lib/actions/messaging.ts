"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { limitRefusalMessage, type OrganizationType, type UsagePrompt } from "@/lib/billing/limits";
import { getConversation, getUnreadMessageCounts, listMessages } from "@/lib/dal/messaging";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { getPublicSettings } from "@/lib/dal/settings";
import { getUsagePrompts } from "@/lib/dal/usage";
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

// limitReached is the upgrade prompt after a refusal at the organisation's monthly limit (FR-P3 AC4).
export type SendMessageResult = { errors?: FieldErrors; message?: string; done?: true; closed?: true; limitReached?: UsagePrompt };

const MESSAGE_LIMIT_KEY = "messages_per_month";

const organizationTypeSchema = z.enum(["employer", "recruitment_company", "staffing_company"]);

const SEND_REFUSALS: Record<string, SendMessageResult> = {
  "CHARA_FORBIDDEN:context_closed": { message: "This conversation is closed for new messages.", closed: true },
  "CHARA_FORBIDDEN:org_suspended": {
    message: "No new messages can be sent while an organisation in this conversation is suspended.",
    closed: true,
  },
  "CHARA_FORBIDDEN:blocked": { message: "This conversation is closed for new messages.", closed: true },
  "CHARA_FORBIDDEN:release_off": { message: RELEASE_OFF },
  "CHARA_FORBIDDEN:aal2_required": { message: "Confirm two-step verification again, then send the message." },
  "CHARA_FORBIDDEN:": { message: "You can no longer send messages in this conversation." },
  "CHARA_RATE_LIMITED:": { message: "You sent many messages in a short time. Wait a minute, then send this one again." },
};

// The upgrade prompt of the organisation of the caller's side, read after the refusal; the limit in words when it cannot
// be read. organizationType only words the prompt: the organisation is the one get_conversation names.
async function messageLimitResult(conversationId: string, organizationType: OrganizationType): Promise<SendMessageResult> {
  const fallback = { message: limitRefusalMessage(MESSAGE_LIMIT_KEY, organizationType) };
  const conversation = await getConversation(conversationId).catch(() => null);
  if (!conversation?.organizationId) return fallback;
  const prompts = await getUsagePrompts(conversation.organizationId, organizationType, [MESSAGE_LIMIT_KEY]).catch(() => null);
  const prompt = prompts?.[MESSAGE_LIMIT_KEY];
  return prompt ? { limitReached: prompt } : fallback;
}

// Sends a plain-text message (FR-P1 AC3, AC9; SOP P2-26 step Send; NFR-S10). The form's rule is checked again here and the
// database stays the authority: the participant, the length setting, the text rules, whether the context still allows
// contact, a block, the throttle and the organisation's monthly limit (FR-P3), whose refusal comes back as the upgrade
// prompt. The body is never logged.
export async function sendMessage(
  conversationId: string,
  input: MessageInput,
  organizationType?: OrganizationType,
): Promise<SendMessageResult> {
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
  if (error.message === "CHARA_LIMIT_REACHED") {
    return messageLimitResult(id.data, organizationTypeSchema.catch("employer").parse(organizationType));
  }
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

export type BlockResult = { message?: string; done?: true };

const BLOCK_REFUSALS: Record<string, string> = {
  "CHARA_INVALID_STATE:blocked": "This conversation is already closed for new messages.",
  "CHARA_INVALID_STATE:not_blocked": "This conversation is not blocked.",
  "CHARA_FORBIDDEN:release_off": RELEASE_OFF,
  "CHARA_FORBIDDEN:": "Only the person who blocked this conversation can unblock it.",
  "CHARA_RATE_LIMITED:": "You made many changes today. Try again tomorrow.",
};

// Blocks the conversation for both sides, or lifts the caller's own block (FR-P3 AC8, SOP P2-28 step Block). The other side
// is not told who blocked it. returnTo is the conversation, where an owner or admin comes back after confirming two-step
// verification.
export async function setConversationBlocked(conversationId: string, blocked: boolean, returnTo: string): Promise<BlockResult> {
  const id = idSchema.safeParse(conversationId);
  if (!id.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_messaging"))) return { message: RELEASE_OFF };
  await requireUser(defaultLocale);

  const { error } = await (await createClient()).rpc(blocked ? "block_conversation" : "unblock_conversation", { p_conversation: id.data });
  if (!error) return { done: true };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "aal2_required") redirect(mfaPath(defaultLocale, safeNextPath(returnTo)));
  return {
    message:
      BLOCK_REFUSALS[`${error.message}:${error.details ?? ""}`] ??
      faultMessage(logFault(blocked ? "Blocking a conversation" : "Unblocking a conversation", error)),
  };
}
