"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { limitRefusalMessage, type OrganizationType } from "@/lib/billing/limits";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole, requireUser } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { conversationPath, mfaPath } from "@/lib/routes";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import {
  inquiryFormSchema,
  jobInvitationFormSchema,
  workforceRequestFormSchema,
  type InquiryFormInput,
  type JobInvitationFormInput,
  type WorkforceRequestFormInput,
} from "@/lib/validation/connection-actions";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

const idSchema = z.uuid();

const RELEASE_OFF = "Messages are not available at the moment.";

// done carries the conversation the action wrote to; existingHref the conversation of an inquiry still waiting (AC2).
export type ConnectionActionResult = { errors?: FieldErrors; message?: string; done?: { href: string }; existingHref?: string };

type DatabaseError = { message: string; details?: string | null };

const REFUSALS: Record<string, string> = {
  "CHARA_NOT_FOUND:": "This company cannot be contacted at the moment.",
  "CHARA_FORBIDDEN:employer_only": "Only employers send inquiries and workforce requests.",
  "CHARA_FORBIDDEN:organization_suspended": "Your organisation is suspended and cannot contact anyone at the moment.",
  "CHARA_FORBIDDEN:blocked": "This conversation is closed for new messages.",
  "CHARA_FORBIDDEN:org_suspended": "No new messages can be sent while an organisation in this conversation is suspended.",
  "CHARA_FORBIDDEN:context_closed": "This conversation is closed for new messages.",
  "CHARA_FORBIDDEN:direct_hiring_blocked": "The rules of the worker's country do not allow direct hiring for this vacancy's country.",
  "CHARA_FORBIDDEN:licensed_partner_required":
    "The rules of the worker's country ask for a licensed recruitment partner for this vacancy's country.",
  "CHARA_FORBIDDEN:partner_pair_not_allowed": "A staffing company sends inquiries to recruitment companies only.",
  "CHARA_FORBIDDEN:self": "Your company cannot send an inquiry to itself.",
  "CHARA_FORBIDDEN:not_listed": "Your company can contact other companies once it is listed in the directory.",
  "CHARA_FORBIDDEN:": "You cannot do this for your organisation.",
  "CHARA_FEATURE_NOT_IN_PLAN:connection_actions": "Contacting partners needs a paid plan. An owner or administrator can upgrade it.",
  "CHARA_RATE_LIMITED:": "You sent many inquiries or messages in a short time. Please try again later.",
  "CHARA_RATE_LIMITED:partner_invitations_per_day": "Your organisation sent the most partner invitations for today. Try again tomorrow.",
  "CHARA_CONFLICT:open_invitation": "This worker already has an invitation to this vacancy waiting.",
  "CHARA_CONFLICT:already_applied": "This worker already applied to this vacancy.",
  "CHARA_JOB_NOT_OPEN:": "This vacancy is not open. Choose an open vacancy.",
  "CHARA_INVALID_INPUT:not_staffing": "This company does not offer staffing.",
};

// A refusal in words, a limit as the plan's limit; aal2_required sends an owner or admin to two-step verification and back
// to returnTo, as the Message button does.
function refusal(error: DatabaseError, returnTo: string, action: string, type: OrganizationType = "employer"): ConnectionActionResult {
  if (error.details === "aal2_required") redirect(mfaPath(defaultLocale, safeNextPath(returnTo)));
  if (error.message === "CHARA_LIMIT_REACHED") return { message: limitRefusalMessage(error.details, type) };
  const known = REFUSALS[`${error.message}:${error.details ?? ""}`] ?? REFUSALS[`${error.message}:`];
  return known ? { message: known } : { message: faultMessage(logFault(action, error)) };
}

// Send inquiry (FR-P2 AC1, AC2; SOP step Send inquiry): any member of the employer slug writes to the partner, and since
// D91 any member of a recruitment or staffing company slug to another partner (send_partner_inquiry, also while release
// 2a is on). A second inquiry while one of the pair waits for an answer is answered with the way to its conversation.
export async function sendInquiry(
  slug: string,
  partnerId: string,
  input: InquiryFormInput,
  returnTo: string,
): Promise<ConnectionActionResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const partner = idSchema.safeParse(partnerId);
  if (!parsedSlug.success || !partner.success) return { message: GENERIC_FAILURE };
  const parsed = inquiryFormSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (!(await isReleased("release_messaging"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", {
    mfa: false,
    hideFromOutsiders: true,
    partner: "either",
  });
  const fromPartner = organization.type !== "employer";
  if (fromPartner && !(await isReleased("release_partner_directories"))) return { message: RELEASE_OFF };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fromPartner ? "send_partner_inquiry" : "send_inquiry", {
    p_org: organization.id,
    p_partner: partner.data,
    p_body: parsed.data.body,
  });
  if (!error) return { done: { href: conversationPath(defaultLocale, organization.slug, data) } };
  if (error.message === "CHARA_INVALID_INPUT" && error.details === "p_body") {
    return { errors: { body: "Check the inquiry: it is too short, too long or has special characters." } };
  }
  if (error.message === "CHARA_CONFLICT") {
    const { data: open } = await supabase.rpc("open_inquiry", { p_org: organization.id, p_partner: partner.data });
    const conversation = open?.[0]?.conversation_id;
    return {
      message: fromPartner
        ? "An inquiry between your company and this company is still waiting for an answer. Continue in its conversation."
        : "Your earlier inquiry to this company is still waiting for an answer. Continue in its conversation.",
      ...(conversation ? { existingHref: conversationPath(defaultLocale, organization.slug, conversation) } : {}),
    };
  }
  return refusal(error, returnTo, "Sending an inquiry", organization.type);
}

// Request workforce (FR-P2 AC3; SOP step Request workforce): an owner or admin of the employer slug asks a staffing
// partner for workers; the database writes the private draft requirement, the invitation and the typed message.
export async function requestWorkforce(
  slug: string,
  partnerId: string,
  input: WorkforceRequestFormInput,
  returnTo: string,
): Promise<ConnectionActionResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const partner = idSchema.safeParse(partnerId);
  if (!parsedSlug.success || !partner.success) return { message: GENERIC_FAILURE };
  const parsed = workforceRequestFormSchema().safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const [messaging, jobOrders] = await Promise.all([isReleased("release_messaging"), isReleased("release_job_orders")]);
  if (!messaging || !jobOrders) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", { mfa: false, hideFromOutsiders: true });

  const { data, error } = await (await createClient()).rpc("request_workforce", {
    p_org: organization.id,
    p_partner: partner.data,
    p_occupation: parsed.data.occupation,
    p_quantity: Number(parsed.data.quantity),
    p_destination: parsed.data.destination,
    p_start_date: parsed.data.startDate,
    p_city_region: parsed.data.cityRegion,
    ...(parsed.data.body ? { p_body: parsed.data.body } : {}),
  });
  if (!error) return { done: { href: conversationPath(defaultLocale, organization.slug, data) } };
  if (error.message === "CHARA_INVALID_INPUT") {
    const field = { p_quantity: "quantity", p_occupation: "occupation", p_destination: "destination", p_start_date: "startDate", start_date: "startDate", p_city_region: "cityRegion", p_body: "body" }[error.details ?? ""];
    if (field) return { errors: { [field]: "Check this field." } };
    if (error.details === "p_industry") return { message: "Add your organisation's industry to its details first." };
  }
  return refusal(error, returnTo, "Requesting workforce");
}

const inviteTargetSchema = z.union([z.object({ conversationId: z.uuid() }), z.object({ contactRequestId: z.uuid() })]);

// Invite to job (FR-P2 AC4; SOP step Invite to job): a member of the organisation slug invites the worker of a
// conversation, or of an accepted contact request (whose conversation is opened first), to apply to an open vacancy.
export async function inviteToJob(
  slug: string,
  target: { conversationId: string } | { contactRequestId: string },
  input: JobInvitationFormInput,
  returnTo: string,
): Promise<ConnectionActionResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedTarget = inviteTargetSchema.safeParse(target);
  if (!parsedSlug.success || !parsedTarget.success) return { message: GENERIC_FAILURE };
  const parsed = jobInvitationFormSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (!(await isReleased("release_messaging"))) return { message: RELEASE_OFF };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", {
    mfa: false,
    hideFromOutsiders: true,
    partner: "either",
  });

  const supabase = await createClient();
  let conversationId: string;
  if ("conversationId" in parsedTarget.data) {
    conversationId = parsedTarget.data.conversationId;
  } else {
    const opened = await supabase.rpc("open_conversation", {
      p_context_type: "contact_request",
      p_context_id: parsedTarget.data.contactRequestId,
    });
    if (opened.error) return refusal(opened.error, returnTo, "Opening a conversation");
    conversationId = opened.data;
  }
  const { error } = await supabase.rpc("invite_to_job", {
    p_conversation: conversationId,
    p_job: parsed.data.jobId,
    ...(parsed.data.body ? { p_body: parsed.data.body } : {}),
  });
  const href = conversationPath(defaultLocale, organization.slug, conversationId);
  revalidatePath(href);
  if (!error) return { done: { href } };
  if (error.message === "CHARA_INVALID_INPUT") return { errors: { body: "Check the message: it is too long or has special characters." } };
  return refusal(error, returnTo, "Inviting a worker to apply");
}

// The receiving side declines a typed message waiting for its answer (FR-P2 AC7; SOP step Track).
export async function declineConnection(connectionId: string, returnTo: string): Promise<{ message?: string }> {
  const id = idSchema.safeParse(connectionId);
  if (!id.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_messaging"))) return { message: RELEASE_OFF };
  await requireUser(defaultLocale);
  const { error } = await (await createClient()).rpc("set_connection_status", { p_connection: id.data, p_status: "declined" });
  revalidatePath(safeNextPath(returnTo));
  if (!error) return {};
  if (error.details === "aal2_required") redirect(mfaPath(defaultLocale, safeNextPath(returnTo)));
  if (error.message === "CHARA_INVALID_TRANSITION") return { message: "This has already been answered." };
  if (error.message === "CHARA_FORBIDDEN") return { message: "You cannot answer this." };
  if (error.message === "CHARA_RATE_LIMITED") return { message: "Too many changes in a short time. Please try again later." };
  return { message: faultMessage(logFault("Declining a connection", error)) };
}
