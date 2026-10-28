"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { planComparison, type UsagePrompt } from "@/lib/billing/limits";
import { getInvitationUsage } from "@/lib/dal/invitations";
import { listPublicPlans } from "@/lib/dal/pricing";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import type { InvitationStatus, InvitationUsage } from "@/lib/invitations/presentation";
import { answerRefusal, INVITATION_LIMIT_KEY, INVITATION_MESSAGES, inviteRefusal, withdrawRefusal } from "@/lib/invitations/refusal";
import { reportQuotaRefused } from "@/lib/quota-refused";
import {
  invitationPath,
  invitationsPath,
  requirementInvitationsPath,
  requirementPartnersPath,
  requirementPath,
  savedPartnersPath,
} from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import {
  answerInputSchema,
  invitePartnersInputSchema,
  withdrawInputSchema,
  type AnswerInput,
  type InvitePartnersInput,
  type WithdrawInput,
} from "@/lib/validation/invitation-input";
import type { FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

// outcomes lists every partner of the call with its invitation (already_invited for one that had an invitation in any
// status); usage is the allowance after the call, for "3 of 3 invitations used"; limitReached the upgrade prompt after
// a refusal at the plan's limit.
export type InviteResult = {
  message?: string;
  outcomes?: { partnerId: string; status: InvitationStatus; alreadyInvited: boolean }[];
  usage?: InvitationUsage;
  limitReached?: UsagePrompt;
};

function revalidateRequirement(slug: string, requirementId: string): void {
  revalidatePath(requirementPath(defaultLocale, slug, requirementId));
  revalidatePath(requirementInvitationsPath(defaultLocale, slug, requirementId));
  revalidatePath(requirementPartnersPath(defaultLocale, slug, requirementId));
}

// Read after the refusal, so the prompt shows what another admin's invitations left behind, with how the higher public
// plans compare; without the allowance the refusal is said in words.
async function limitResult(organizationId: string, requirementId: string): Promise<InviteResult> {
  const [usage, plans] = await Promise.all([
    getInvitationUsage(organizationId, requirementId).catch(() => null),
    listPublicPlans("employer").catch(() => null),
  ]);
  if (!usage || usage.limit === null) return { message: "Your plan's limit of invitations for this requirement is reached." };
  return {
    limitReached: {
      limitKey: INVITATION_LIMIT_KEY,
      used: usage.used,
      limit: usage.limit,
      resetsAt: null,
      planName: usage.planName,
      comparison: plans ? planComparison(plans, INVITATION_LIMIT_KEY, "employer", usage.limit) : null,
    },
  };
}

// Invites partners to an open requirement (FR-O1 step Invite, AC1 to AC6, AC12; FR-M3 AC7): from the suggestions (up to
// 25 selected at a time), a profile or the saved partners. An owner or admin at aal2 of the organisation of the address
// (requireOrgRole sends an aal1 session to two-step verification), while release 2b is on; invite_partners checks all
// of it again, with the requirement's status, the partners, the plan's limit for the requirement and the daily cap.
export async function invitePartners(slug: string, input: InvitePartnersInput): Promise<InviteResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsed = invitePartnersInputSchema.safeParse(input);
  if (!parsedSlug.success || !parsed.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_job_orders"))) return { message: INVITATION_MESSAGES.releaseOff };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", { hideFromOutsiders: true });

  const { requirementId, partnerIds, source } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_partners", {
    p_org: organization.id,
    p_requirement: requirementId,
    p_partners: partnerIds,
    p_source: source,
  });
  revalidateRequirement(organization.slug, requirementId);
  if (error) {
    const refusal = inviteRefusal(error);
    if (refusal.kind === "limit") return limitResult(organization.id, requirementId);
    if (refusal.kind === "message") {
      if (error.message === "CHARA_RATE_LIMITED" && error.details !== "partner_invitations_per_day") {
        reportQuotaRefused("audited_write", "requirement");
      }
      return { message: refusal.message };
    }
    return { message: faultMessage(logFault("Inviting partners to the workforce requirement", error)) };
  }
  revalidatePath(savedPartnersPath(defaultLocale, organization.slug));
  return {
    outcomes: data.map((row) => ({ partnerId: row.organization_id, status: row.status, alreadyInvited: row.already_invited })),
    usage: await getInvitationUsage(organization.id, requirementId).catch(() => undefined),
  };
}

export type InvitationActionResult = { message?: string; errors?: FieldErrors; done?: boolean };

// Withdraws an invitation before a response (FR-O1 step Withdraw, AC10), for an owner or admin at aal2, after the
// confirmation of the page; withdraw_invitation tells the partner's owners and admins.
export async function withdrawInvitation(slug: string, input: WithdrawInput): Promise<InvitationActionResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsed = withdrawInputSchema.safeParse(input);
  if (!parsedSlug.success || !parsed.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_job_orders"))) return { message: INVITATION_MESSAGES.releaseOff };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", { hideFromOutsiders: true });

  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_invitation", { p_org: organization.id, p_invitation: parsed.data.invitationId });
  revalidateRequirement(organization.slug, parsed.data.requirementId);
  if (!error) return { done: true };
  const refusal = withdrawRefusal(error);
  if (refusal.kind === "message") {
    if (error.message === "CHARA_RATE_LIMITED") reportQuotaRefused("audited_write", "requirement");
    return { message: refusal.message };
  }
  return { message: faultMessage(logFault("Withdrawing the invitation", error)) };
}

// Accepts or declines an invitation (FR-O1 step Answer, AC8), for any member of the invited recruitment or staffing
// company while release 2b is on; a decline may carry a reason the employer reads. answer_invitation checks the status
// and the reason again.
export async function answerInvitation(slug: string, input: AnswerInput): Promise<InvitationActionResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsed = answerInputSchema.safeParse(input);
  if (!parsedSlug.success) return { message: GENERIC_FAILURE };
  if (!parsed.success) {
    return parsed.error.issues.some((issue) => issue.path[0] === "reason")
      ? { errors: { reason: INVITATION_MESSAGES.reason } }
      : { message: GENERIC_FAILURE };
  }
  if (!(await isReleased("release_job_orders"))) return { message: INVITATION_MESSAGES.releaseOff };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", {
    mfa: false,
    hideFromOutsiders: true,
    partner: true,
  });

  const { invitationId, answer, reason } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_invitation", {
    p_org: organization.id,
    p_invitation: invitationId,
    p_answer: answer,
    p_reason: answer === "declined" && reason !== "" ? reason : undefined,
  });
  revalidatePath(invitationsPath(defaultLocale, organization.slug));
  revalidatePath(invitationPath(defaultLocale, organization.slug, invitationId));
  if (!error) return { done: true };
  const refusal = answerRefusal(error);
  if (refusal.kind === "field") return { errors: { reason: refusal.message } };
  if (refusal.kind === "message") return { message: refusal.message };
  return { message: faultMessage(logFault("Answering the invitation", error)) };
}
