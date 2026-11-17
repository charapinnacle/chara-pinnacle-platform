import type { Database } from "@chara-pinnacle/db-types";
import type { StatusTone } from "@/lib/status-tone";

export type ContactRequestStatus = Database["public"]["Enums"]["contact_request_status"];

export const contactRequestStatuses = ["pending", "accepted", "declined", "expired", "withdrawn"] as const satisfies readonly ContactRequestStatus[];

// The bound of the check on contact_requests.message (FR-Q3 AC2).
export const CONTACT_MESSAGE_MAX = 1_000;

export const contactRequestTones: Record<ContactRequestStatus, StatusTone> = {
  pending: "warning",
  accepted: "success",
  declined: "neutral",
  expired: "neutral",
  withdrawn: "neutral",
};

// The status as the organisation that sent the request reads it (FR-Q3 AC8, AC10): a decline has no reason, an expiry is
// "No answer".
export const sentStatusLabels: Record<ContactRequestStatus, string> = {
  pending: "Waiting for the worker",
  accepted: "Accepted",
  declined: "Declined",
  expired: "No answer",
  withdrawn: "Withdrawn",
};

// What the organisation can do next with a request (NFR-U4).
export const sentNextSteps: Record<ContactRequestStatus, string> = {
  pending: "The worker decides whether to share their name with you. You can withdraw the request while it waits.",
  accepted: "The worker shared their name with you. Continue in the conversation.",
  declined: "The worker declined. Your organisation cannot contact this worker again for 90 days.",
  expired: "The worker did not answer within 30 days. You can send a new request from Find Workers.",
  withdrawn: "You withdrew this request. A new request to this worker is possible 30 days after it was sent.",
};

export const receivedStatusLabels: Record<ContactRequestStatus, string> = {
  pending: "Waiting for your answer",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn by the company",
};

// What the worker can do next with a request (NFR-U4).
export const receivedNextSteps: Record<ContactRequestStatus, string> = {
  pending: "Accept to share your first and last name with this company and start a conversation, or decline.",
  accepted: "You shared your name with this company. Continue in the conversation.",
  declined: "You declined. This company cannot contact you again for 90 days.",
  expired: "You did not answer within 30 days, so the request closed. Nothing was shared.",
  withdrawn: "The company withdrew this request. Nothing was shared.",
};

export const organizationTypeLabels: Record<Database["public"]["Enums"]["organization_type"], string> = {
  employer: "Employer",
  recruitment_company: "Recruitment company",
  staffing_company: "Staffing company",
};

export function isContactRequestStatus(value: unknown): value is ContactRequestStatus {
  return typeof value === "string" && (contactRequestStatuses as readonly string[]).includes(value);
}

// Why send_contact_request refused, in words for the dialog (FR-Q3 AC12); null for a failure the dialog cannot explain.
export function sendRefusalText(error: { message: string; details?: string | null }): string | null {
  if (error.message === "CHARA_CONFLICT") {
    if (error.details === "declined") return "This worker declined a request from your organisation in the last 90 days.";
    if (error.details === "accepted") return "This worker already accepted a request from your organisation. Continue in Messages.";
    return "Your organisation already sent this worker a request in the last 30 days.";
  }
  if (error.message === "CHARA_RATE_LIMITED") {
    return error.details === "contact_requests_per_day"
      ? "Your organisation reached its contact requests for today. Try again tomorrow."
      : "Too many changes in a short time. Please try again later.";
  }
  if (error.message === "CHARA_FORBIDDEN" && error.details === "direct_hiring_blocked") {
    return "Direct hiring from this worker's country to the destination is not allowed, so a request cannot be sent.";
  }
  if (error.message === "CHARA_FORBIDDEN" && error.details === "licensed_partner_required") {
    return "Hiring from this worker's country to the destination needs a licensed recruitment partner, so your organisation cannot contact the worker directly.";
  }
  if (error.message === "CHARA_NOT_FOUND") return "This worker is no longer visible in Find Workers.";
  if (error.message === "CHARA_JOB_NOT_OPEN") return "The vacancy is no longer open. Choose another one or send the request without a vacancy.";
  if (error.message === "CHARA_FEATURE_NOT_IN_PLAN") return "Find Workers is part of the paid plans.";
  return null;
}
