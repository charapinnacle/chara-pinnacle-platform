"use server";

import { revalidatePath } from "next/cache";
import { adminRefusal, type AdminResult } from "@/lib/actions/admin-errors";
import { adminClient } from "@/lib/dal/admin";
import { getReportedMessage, type ReportedMessage } from "@/lib/dal/admin-reports";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import { jobModerationInputSchema } from "@/lib/validation/admin";
import {
  reportDecisionInputSchema,
  reportIdSchema,
  reportMoveInputSchema,
  reportStatusLabels,
  type ReportDecisionInput,
  type ReportMoveInput,
} from "@/lib/validation/report";
import { fieldErrors } from "@/lib/validation/sign-up";

const REASON_ERROR = { errors: { reason: "Give a reason of 10 to 2000 characters." } } as const;

// A report another staff member closed (or moved) first: the database locks the report, so of two simultaneous decisions
// one finds it closed (FR-S1 AC11).
function changed(status: keyof typeof reportStatusLabels): AdminResult {
  return { message: `This report was changed by someone else, reload the page. It is now ${reportStatusLabels[status]}.` };
}

const REPORT_CHANGED = {
  "CHARA_INVALID_STATE:new": changed("new"),
  "CHARA_INVALID_STATE:in_review": changed("in_review"),
  "CHARA_INVALID_STATE:actioned": changed("actioned"),
  "CHARA_INVALID_STATE:dismissed": changed("dismissed"),
} as const;

const TARGET_CHANGED = {
  "CHARA_INVALID_STATE:hidden": { message: "This item is already hidden. Reload the page." },
  "CHARA_INVALID_STATE:visible": { message: "This item is not hidden. Reload the page." },
  "CHARA_INVALID_STATE:org_suspended": { message: "This item is hidden with the suspension of its organisation. Reload the page." },
  "CHARA_INVALID_STATE:suspended": { message: "This organisation is already suspended. Reload the page." },
  "CHARA_INVALID_STATE:active": { message: "This organisation is not suspended. Reload the page." },
  "CHARA_FORBIDDEN:release_off": { message: "Partner profiles are not live yet, so there is nothing to decide on." },
  "CHARA_INVALID_INPUT:decision": { message: "This decision does not fit what the report is about. Reload the page." },
  "CHARA_INVALID_INPUT:reason": REASON_ERROR,
} as const;

// Only Trust & Safety act on a report; the Platform Administrator reads. A move to review takes a reason (FR-F1); a report
// about a candidate or a page is closed with a note, which a signed-in reporter reads.
export async function moveReport(input: ReportMoveInput): Promise<AdminResult> {
  const parsed = reportMoveInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { id, status, reason } = parsed.data;
  await requirePlatformRole(defaultLocale, ["trust_safety"]);

  const path = adminPath(defaultLocale, `reports/${id}`);
  const { error } = await (await adminClient()).rpc("admin_set_report_status", { p_id: id, p_status: status, p_note: reason });
  if (error) {
    return adminRefusal(error, path, {
      ...REPORT_CHANGED,
      "CHARA_INVALID_INPUT:reason": { errors: { reason: "Give a note of 10 to 2000 characters." } },
    });
  }
  revalidatePath(path);
  return { done: true };
}

// A decision of FR-S1 on a report: hide the item, suspend its organisation or dismiss, with the statement of reasons. The
// database closes the report in the same transaction and informs the affected party and the reporter.
export async function decideReport(input: ReportDecisionInput): Promise<AdminResult> {
  const parsed = reportDecisionInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { id, decision, reason } = parsed.data;
  await requirePlatformRole(defaultLocale, ["trust_safety"]);

  const path = adminPath(defaultLocale, `reports/${id}`);
  const { error } = await (await adminClient()).rpc("moderation_decide", { p_decision: decision, p_reasons: reason, p_report: id });
  if (error) {
    return adminRefusal(error, path, {
      ...REPORT_CHANGED,
      ...TARGET_CHANGED,
      "CHARA_INVALID_STATE:not_in_review": {
        message: "Only the administrator who put this report in review decides it, after reading what was reported.",
      },
    });
  }
  revalidatePath(path);
  return { done: true };
}

const MESSAGE_REFUSALS = {
  CHARA_FORBIDDEN: { message: "Only the Trust & Safety Administrator who put this report in review can open what was reported." },
  "CHARA_FORBIDDEN:release_off": { message: "This part of the platform is not live yet." },
  "CHARA_INVALID_STATE:new": { message: "Put the report in review first. It opens for the person who does." },
  "CHARA_INVALID_STATE:actioned": changed("actioned"),
  "CHARA_INVALID_STATE:dismissed": changed("dismissed"),
  "CHARA_NOT_FOUND:message_gone": { message: "It has been deleted since it was reported (retention or erasure)." },
} as const;

// Opens the reported message and the ten around it, or the reported contact request, for the handler of the report (FR-P3
// AC7, NFR-C5). Each call is one opening, which the database audits, so the page asks for it only when the handler
// chooses to read it.
export async function openReportedMessage(id: number): Promise<AdminResult & { messages?: ReportedMessage[] }> {
  const parsed = reportIdSchema.safeParse(id);
  if (!parsed.success) return { message: "This record no longer exists." };
  await requirePlatformRole(defaultLocale, ["trust_safety"]);
  const result = await getReportedMessage(parsed.data);
  if (!result.ok) return adminRefusal(result.error, adminPath(defaultLocale, `reports/${parsed.data}`), MESSAGE_REFUSALS);
  return { done: true, messages: result.messages };
}

type PartnerProfileInput = { id: string; action: "hide" | "unhide"; reason: string };

// A partner profile hidden or shown again on staff's own finding, from the page of the organisation.
export async function moderatePartnerProfile(input: PartnerProfileInput): Promise<AdminResult> {
  const parsed = jobModerationInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { id, action, reason } = parsed.data;
  await requirePlatformRole(defaultLocale, ["trust_safety"]);

  const path = adminPath(defaultLocale, `organizations/${id}`);
  const { error } = await (await adminClient()).rpc("moderation_decide", {
    p_decision: action,
    p_reasons: reason,
    p_target_type: "partner_profile",
    p_target_id: id,
  });
  if (error) return adminRefusal(error, path, TARGET_CHANGED);
  revalidatePath(path);
  return { done: true };
}
