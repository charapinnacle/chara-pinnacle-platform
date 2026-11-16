import { partnerStatusLabels, responseStatuses, type ResponseStatus } from "@/lib/responses/presentation";
import {
  AVAILABLE_FROM_LATE,
  capacityAboveText,
  CAPACITY_WHOLE,
  CURRENCY_REQUIRED,
  EXPERIENCE_TEXT,
  FEE_MODEL_REQUIRED,
  type ResponseFormInput,
} from "@/lib/validation/response";

type RefusalError = { code?: string; message: string; details?: string | null };

export const RESPONSE_LIMIT_KEY = "job_order_responses_per_month";

export const RESPONSE_MESSAGES = {
  releaseOff: "Responses cannot be sent or changed at the moment.",
  suspended: "Your company is suspended, so it cannot respond.",
  notListed: "Your company cannot respond at the moment: it must be listed in the partner directories and visible.",
  notAllowed: "You are not allowed to respond for this company.",
  notFound: "This job order is not available. Reload the page.",
  responseNotFound: "This response could not be found. Reload the page.",
  notOpen: "This job order is not open to responses at the moment.",
  closed: "The requirement is closed, so the response can no longer be changed.",
  alreadyResponded: "Your company has already responded to this job order. Open its response from Responses.",
  stale: "Someone changed this response since you opened it. Reload the page to see the current version, then make your changes again.",
  plan: "Responding to job orders needs a paid partner plan.",
  commitment: "Your company's owner must accept the current employer-pays commitment before your company can respond.",
  conditions: "Your company no longer meets the conditions of this job order. Reload the page.",
  scanning: "A document is still being checked, try again in a minute.",
  uploadMissing: "A document is still being uploaded. Wait until it is sent or remove it, then try again.",
  tooManyChanges: "Too many changes were made today. Try again tomorrow.",
  reason: "Write at most 500 characters, without special characters.",
  feeRules: "Check the amount and the currency for this fee model.",
} as const;

// A refusal of respond_to_invitation or update_response: a field of the form; the plan's monthly limit, which the page
// answers with the upgrade prompt (V13); the licence a destination needs, which the page names; a message; or a fault the
// caller logs. No SQL text or detail of an unexpected error reaches the screen.
export type ResponseRefusal =
  | { kind: "field"; field: keyof ResponseFormInput; message: string }
  | { kind: "limit" }
  | { kind: "licence"; country: string }
  | { kind: "message"; message: string }
  | { kind: "fault" };

const fieldOfDetail: Record<string, [keyof ResponseFormInput, string]> = {
  capacity: ["capacity", CAPACITY_WHOLE],
  available_from: ["availableFrom", AVAILABLE_FROM_LATE],
  experience_note: ["experienceNote", EXPERIENCE_TEXT],
  timeline_note: ["timelineNote", "Write at most 1,000 characters, without special characters."],
  notes: ["notes", "Write at most 2,000 characters, without special characters."],
  fee_model: ["feeModel", FEE_MODEL_REQUIRED],
};

function statusOf(detail: string | null | undefined): ResponseStatus | undefined {
  return responseStatuses.find((status) => status === detail);
}

// The refusals every response function shares: who may act, the release, the organisation and the quota of audited
// writes.
function sharedRefusal(error: RefusalError, notFound: string): { kind: "message"; message: string } | null {
  if (error.message === "CHARA_FORBIDDEN") {
    if (error.details === "release_off") return { kind: "message", message: RESPONSE_MESSAGES.releaseOff };
    if (error.details === "organization_suspended") return { kind: "message", message: RESPONSE_MESSAGES.suspended };
    if (error.details === "not_listed" || error.details === "profile_hidden") return { kind: "message", message: RESPONSE_MESSAGES.notListed };
    if (error.details === "served_country_missing" || error.details === "occupation_missing") {
      return { kind: "message", message: RESPONSE_MESSAGES.conditions };
    }
    return { kind: "message", message: RESPONSE_MESSAGES.notAllowed };
  }
  if (error.code === "42501") return { kind: "message", message: RESPONSE_MESSAGES.notAllowed };
  if (error.message === "CHARA_NOT_FOUND" || error.code === "P0002") return { kind: "message", message: notFound };
  if (error.message === "CHARA_RATE_LIMITED") return { kind: "message", message: RESPONSE_MESSAGES.tooManyChanges };
  return null;
}

function stateMessage(detail: string | null | undefined): string {
  if (detail === "requirement_not_open") return RESPONSE_MESSAGES.notOpen;
  if (detail === "requirement_closed") return RESPONSE_MESSAGES.closed;
  const status = statusOf(detail);
  return status
    ? `This response is ${partnerStatusLabels[status].toLowerCase()} and can no longer be changed. Reload the page.`
    : RESPONSE_MESSAGES.responseNotFound;
}

export function responseRefusal(error: RefusalError): ResponseRefusal {
  if (error.message === "CHARA_INVALID_INPUT") {
    const detail = error.details ?? "";
    const above = /^capacity_above_allowed:(\d+)$/.exec(detail);
    if (above) return { kind: "field", field: "capacity", message: capacityAboveText(Number(above[1])) };
    const field = fieldOfDetail[detail];
    return field ? { kind: "field", field: field[0], message: field[1] } : { kind: "fault" };
  }
  // The table's check of the fee (23514) and the list of currencies (23503), FR-O2 AC3.
  if (error.code === "23514") return { kind: "field", field: "feeAmount", message: RESPONSE_MESSAGES.feeRules };
  if (error.code === "23503") return { kind: "field", field: "feeCurrency", message: CURRENCY_REQUIRED };
  if (error.message === "CHARA_DOCUMENT_NOT_SCANNED") {
    return { kind: "message", message: error.details === "upload_missing" ? RESPONSE_MESSAGES.uploadMissing : RESPONSE_MESSAGES.scanning };
  }
  if (error.message === "CHARA_LIMIT_REACHED") return error.details === RESPONSE_LIMIT_KEY ? { kind: "limit" } : { kind: "fault" };
  if (error.message === "CHARA_LICENCE_REQUIRED" && error.details) return { kind: "licence", country: error.details };
  if (error.message === "CHARA_FEATURE_NOT_IN_PLAN") return { kind: "message", message: RESPONSE_MESSAGES.plan };
  if (error.message === "CHARA_CONSENT_REQUIRED") return { kind: "message", message: RESPONSE_MESSAGES.commitment };
  if (error.message === "CHARA_CONFLICT") {
    if (error.details === "stale") return { kind: "message", message: RESPONSE_MESSAGES.stale };
    if (error.details === "already_responded") return { kind: "message", message: RESPONSE_MESSAGES.alreadyResponded };
    return { kind: "fault" };
  }
  if (error.message === "CHARA_INVALID_STATE") return { kind: "message", message: stateMessage(error.details) };
  return sharedRefusal(error, RESPONSE_MESSAGES.notFound) ?? { kind: "fault" };
}

// A refusal of withdraw_response: the reason (a field of the dialog), a response that is no longer live with its
// status, or a shared refusal.
export function withdrawRefusal(
  error: RefusalError,
): { kind: "field"; message: string } | { kind: "message"; message: string } | { kind: "fault" } {
  if (error.message === "CHARA_INVALID_INPUT" && error.details === "p_reason") return { kind: "field", message: RESPONSE_MESSAGES.reason };
  if (error.message === "CHARA_INVALID_STATE") {
    const status = statusOf(error.details);
    return {
      kind: "message",
      message: status
        ? `This response is ${partnerStatusLabels[status].toLowerCase()} and can no longer be withdrawn. Reload the page.`
        : RESPONSE_MESSAGES.responseNotFound,
    };
  }
  return sharedRefusal(error, RESPONSE_MESSAGES.responseNotFound) ?? { kind: "fault" };
}

// What the document-url function answered for a response document (V45).
export const documentRefusals = [
  "invalid_file",
  "bad_request",
  "forbidden",
  "not_found",
  "not_scanned",
  "documents_limit",
  "response_limit",
  "cannot_respond",
  "invalid_state",
  "rate_limited",
  "unauthorized",
  "unavailable",
] as const;
export type DocumentRefusal = (typeof documentRefusals)[number];

export function documentRefusalMessage(refusal: DocumentRefusal, limitText: string): string {
  switch (refusal) {
    case "invalid_file":
    case "bad_request":
      return "Choose a PDF file of up to 15 MB whose name ends in .pdf.";
    case "documents_limit":
      return `${limitText}.`;
    case "not_scanned":
      return "This document is still being checked, try again in a minute.";
    case "response_limit":
      return "Your plan's limit of responses this month is reached, so no document can be added to a new response.";
    case "cannot_respond":
      return "Your company cannot respond to this job order at the moment. Reload the page to see why.";
    case "invalid_state":
      return "Documents can no longer be added to or removed from this response. Reload the page.";
    case "rate_limited":
      return "Too many documents were sent or opened in a short time. Wait a minute and try again.";
    case "forbidden":
    case "not_found":
    case "unauthorized":
      return "This document is not available. Reload the page.";
    case "unavailable":
      return "The document service did not answer. Try again in a moment.";
  }
}

export const DECISION_MESSAGES = {
  note: "Write at most 1,000 characters, without special characters.",
  decided: "This response was decided or withdrawn meanwhile. Reload the page to see its status.",
  notOpen: "The requirement is closed or filled, so its responses can no longer be decided.",
  notShortlisted: "Only a shortlisted response can be opened to candidate submissions. Reload the page to see its status.",
  notAllowed: "Only the owner and admins of the company can decide responses.",
} as const;

// A refusal of decide_response or set_submissions_allowed (FR-O3 AC3 to AC5, AC8, AC9): the note (a field of the
// dialog), a move the response no longer allows, a requirement that is no longer open or paused, or a shared refusal.
export function decisionRefusal(
  error: RefusalError,
): { kind: "field"; message: string } | { kind: "message"; message: string } | { kind: "fault" } {
  if (error.message === "CHARA_INVALID_INPUT" && error.details === "p_note") return { kind: "field", message: DECISION_MESSAGES.note };
  if (error.message === "CHARA_INVALID_TRANSITION") return { kind: "message", message: DECISION_MESSAGES.decided };
  if (error.message === "CHARA_INVALID_STATE") {
    return {
      kind: "message",
      message: error.details === "requirement_not_open" ? DECISION_MESSAGES.notOpen : DECISION_MESSAGES.notShortlisted,
    };
  }
  // The role check of private.assert_org_manager: no member of the employer, below admin, or not at aal2.
  if (error.message === "CHARA_FORBIDDEN" && (!error.details || error.details === "aal2_required")) {
    return { kind: "message", message: DECISION_MESSAGES.notAllowed };
  }
  return sharedRefusal(error, RESPONSE_MESSAGES.responseNotFound) ?? { kind: "fault" };
}
