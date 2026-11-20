"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { sendRefusalText } from "@/lib/contact-requests/presentation";
import { isReleased } from "@/lib/dal/release";
import { requireCandidate, requireOrgRole } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { contactRequestsPath, conversationPath, findWorkersPath, orgContactRequestsPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import {
  CONTACT_MESSAGE_REQUIRED,
  CONTACT_MESSAGE_TOO_LONG,
  contactDecisionSchema,
  contactRequestFormSchema,
  type ContactDecision,
  type ContactRequestFormInput,
} from "@/lib/validation/contact-request";
import { slugSchema } from "@/lib/validation/team";

const idSchema = z.uuid();

const RELEASE_OFF = "Find Workers is not available at the moment.";

export type SendContactRequestResult = { errors?: { message?: string; jobId?: string }; message?: string; done?: true };

// Sends a contact request from the organisation slug to the worker behind cardId (FR-Q3 AC1, AC12, SOP step Send). Any
// member who may search; send_contact_request checks the release, the plan, the card, the rules and the limits again.
// A refusal comes back as the reason the dialog shows, so the typed message stays.
export async function sendContactRequest(slug: string, cardId: string, input: ContactRequestFormInput): Promise<SendContactRequestResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const card = idSchema.safeParse(cardId);
  if (!parsedSlug.success || !card.success) return { message: GENERIC_FAILURE };
  const parsed = contactRequestFormSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return issue?.path[0] === "jobId" ? { errors: { jobId: GENERIC_FAILURE } } : { errors: { message: issue?.message ?? CONTACT_MESSAGE_REQUIRED } };
  }
  if (!(await isReleased("release_find_workers"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", {
    mfa: false,
    hideFromOutsiders: true,
    partner: "either",
  });

  const supabase = await createClient();
  const { error } = await supabase.rpc("send_contact_request", {
    p_org: organization.id,
    p_card: card.data,
    p_message: parsed.data.message,
    ...(parsed.data.jobId ? { p_job: parsed.data.jobId } : {}),
  });
  revalidatePath(findWorkersPath(defaultLocale, organization.slug));
  revalidatePath(orgContactRequestsPath(defaultLocale, organization.slug));
  if (!error) return { done: true };
  if (error.message === "CHARA_INVALID_INPUT" && error.details === "p_message") return { errors: { message: CONTACT_MESSAGE_TOO_LONG } };
  const refusal = sendRefusalText(error);
  if (refusal) return { message: refusal };
  return { message: faultMessage(logFault("Sending a contact request", error)) };
}

export type RespondResult = { message?: string; conversationHref?: string };

// The worker's answer to a request (FR-Q3 AC8, AC11, SOP steps Decide and Reveal). After an acceptance the worker is taken to
// the new conversation, when messaging is released.
export async function respondToContactRequest(requestId: string, decision: ContactDecision): Promise<RespondResult> {
  const id = idSchema.safeParse(requestId);
  const parsedDecision = contactDecisionSchema.safeParse(decision);
  if (!id.success || !parsedDecision.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_find_workers"))) return { message: RELEASE_OFF };
  await requireCandidate(defaultLocale);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_to_contact_request", { p_request: id.data, p_decision: parsedDecision.data });
  revalidatePath(contactRequestsPath(defaultLocale));
  if (!error) {
    const conversation = idSchema.safeParse(data);
    return conversation.success ? { conversationHref: conversationPath(defaultLocale, null, conversation.data) } : {};
  }
  if (error.message === "CHARA_INVALID_TRANSITION") return { message: "This request is no longer waiting for your answer." };
  if (error.message === "CHARA_FORBIDDEN") return { message: "This request is not available." };
  if (error.message === "CHARA_RATE_LIMITED") return { message: "Too many changes in a short time. Please try again later." };
  return { message: faultMessage(logFault("Answering a contact request", error)) };
}

// Withdraws a request of the organisation slug that waits for the worker (NFR-U4: the next action of a pending request).
export async function withdrawContactRequest(slug: string, requestId: string): Promise<{ message?: string }> {
  const parsedSlug = slugSchema.safeParse(slug);
  const id = idSchema.safeParse(requestId);
  if (!parsedSlug.success || !id.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_find_workers"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", { hideFromOutsiders: true, partner: "either" });

  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_contact_request", { p_org: organization.id, p_request: id.data });
  revalidatePath(orgContactRequestsPath(defaultLocale, organization.slug));
  if (!error) return {};
  if (error.message === "CHARA_INVALID_TRANSITION") return { message: "This request is no longer waiting for the worker." };
  if (error.message === "CHARA_NOT_FOUND") return { message: "This request is not available." };
  if (error.message === "CHARA_RATE_LIMITED") return { message: "Too many changes in a short time. Please try again later." };
  return { message: faultMessage(logFault("Withdrawing a contact request", error)) };
}
