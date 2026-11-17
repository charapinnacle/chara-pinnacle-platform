import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { formatCount } from "@/lib/i18n/format";
import { characters } from "@/lib/utils";
import { CONTROL_CHARACTER, LINE_BREAKS_AND_TABS, NO_CONTROL_CHARACTERS } from "@/lib/validation/job";
import { slugSchema } from "@/lib/validation/team";

export type ConversationContext = Database["public"]["Enums"]["conversation_context"];

// The bound of the check on messages.body; the setting message_body_max_chars may only lower it (V63).
const MESSAGE_MAX_CHARS = 4_000;

const MESSAGE_REQUIRED = "Write a message.";

function messageTooLongText(max: number): string {
  return `A message has at most ${formatCount(max)} characters.`;
}

// The rule of send_message: CR LF taken as a line feed, trimmed, 1 to max characters, no control character but line feed
// and tab. The database stays the authority.
export function messageSchema(max: number) {
  return z.object({
    body: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n").trim())
      .refine((value) => value.length > 0, { error: MESSAGE_REQUIRED })
      .refine((value) => characters(value) <= max, { error: messageTooLongText(max) })
      .refine((value) => !CONTROL_CHARACTER.test(value.replace(LINE_BREAKS_AND_TABS, "")), { error: NO_CONTROL_CHARACTERS }),
  });
}

export type MessageInput = z.input<ReturnType<typeof messageSchema>>;

// The first max characters of value, as the database counts them: the composer takes no character past the limit.
export function clampCharacters(value: string, max: number): string {
  return characters(value) <= max ? value : Array.from(value).slice(0, max).join("");
}

// message_body_max_chars as the public settings answer it, within the check's bound; anything else is the bound.
export function parseMessageMaxChars(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MESSAGE_MAX_CHARS ? parsed : MESSAGE_MAX_CHARS;
}

// The contexts the pages open and filter conversations by (V63, decision 5.1); contact requests (V70) and inquiries (V71)
// join with their units.
const pageContexts = ["application", "candidate_submission", "requirement_invitation", "partner_response"] as const;

export type PageContext = (typeof pageContexts)[number];

export const openConversationSchema = z.object({
  contextType: z.enum(pageContexts),
  contextId: z.uuid(),
  slug: slugSchema.nullable(),
});

// The context filter of the inbox, from the address; anything else lists every conversation.
export function parseInboxFilter(value: unknown): PageContext | null {
  return pageContexts.find((context) => context === value) ?? null;
}
