import { SUBMISSION_LIMIT_KEY } from "@/lib/submissions/presentation";
import { CANDIDATE_EMAIL_INVALID, SUBMISSION_NOTE_TOO_LONG } from "@/lib/validation/submission";

type RefusalError = { code?: string; message: string; details?: string | null };

export const SUBMISSION_MESSAGES = {
  releaseOff: "Candidate submissions are not available at the moment.",
  suspended: "Your company is suspended, so it cannot submit candidates.",
  notListed: "Your company cannot submit candidates at the moment: it must be listed in the partner directories and visible.",
  notAllowed: "You are not allowed to submit candidates for this company.",
  notOpenToYou: "The employer has not opened candidate submissions to your company for this requirement.",
  requirementNotOpen: "The requirement is not open at the moment, so no candidate can be submitted.",
  plan: "Submitting candidates needs a paid partner plan.",
  commitment: "Your company's owner must accept the current employer-pays commitment before your company can submit candidates.",
  requirementNotFound: "This requirement is not available. Reload the page.",
  tooManyChanges: "Too many changes were made today. Try again tomorrow.",
  limit: "Your plan's limit of candidate submissions this month is reached.",
  requestNotFound: "This request could not be found, or a document you chose was removed. Reload the page.",
  answered: "This request was already answered. Reload the page to see its status.",
  expired: "This request expired, so it can no longer be answered.",
  closed: "The requirement is no longer open, so the request can no longer be approved. You can still decline it.",
  alreadySubmitted: "You have already been submitted for this requirement by another company, so you can only decline this request.",
  scanning: "A document you chose is still being checked. Try again in a minute, or approve without it.",
  documents: "Choose fewer documents, all of them your own.",
  accountClosing: "Your account is being closed, so nothing can be shared.",
  notWithdrawable: "This submission can no longer be withdrawn. Reload the page to see its status.",
} as const;

// A refusal of submit_candidate (FR-O4 AC2 to AC4, AC12): a field of the form, the plan's monthly limit (answered with
// the upgrade prompt), a message, or a fault the caller logs. The reply never tells whether an address has an account.
export type SubmitRefusal =
  | { kind: "field"; field: "email" | "note"; message: string }
  | { kind: "limit" }
  | { kind: "message"; message: string }
  | { kind: "fault" };

export function submitRefusal(error: RefusalError): SubmitRefusal {
  switch (error.message) {
    case "CHARA_INVALID_INPUT":
      if (error.details === "p_email") return { kind: "field", field: "email", message: CANDIDATE_EMAIL_INVALID };
      if (error.details === "p_note") return { kind: "field", field: "note", message: SUBMISSION_NOTE_TOO_LONG };
      return { kind: "fault" };
    case "CHARA_LIMIT_REACHED":
      return error.details === SUBMISSION_LIMIT_KEY ? { kind: "limit" } : { kind: "fault" };
    case "CHARA_FEATURE_NOT_IN_PLAN":
      return { kind: "message", message: SUBMISSION_MESSAGES.plan };
    case "CHARA_CONSENT_REQUIRED":
      return { kind: "message", message: SUBMISSION_MESSAGES.commitment };
    case "CHARA_INVALID_STATE":
      return { kind: "message", message: SUBMISSION_MESSAGES.requirementNotOpen };
    case "CHARA_NOT_FOUND":
      return { kind: "message", message: SUBMISSION_MESSAGES.requirementNotFound };
    case "CHARA_RATE_LIMITED":
      return { kind: "message", message: SUBMISSION_MESSAGES.tooManyChanges };
    case "CHARA_FORBIDDEN":
      switch (error.details) {
        case "release_off":
          return { kind: "message", message: SUBMISSION_MESSAGES.releaseOff };
        case "submissions_not_open":
          return { kind: "message", message: SUBMISSION_MESSAGES.notOpenToYou };
        case "organization_suspended":
          return { kind: "message", message: SUBMISSION_MESSAGES.suspended };
        case "not_listed":
        case "profile_hidden":
          return { kind: "message", message: SUBMISSION_MESSAGES.notListed };
        default:
          return { kind: "message", message: SUBMISSION_MESSAGES.notAllowed };
      }
    default:
      return { kind: "fault" };
  }
}

// A refusal of approve_submission or decline_submission (FR-O4 AC5, AC7, AC8): the documents (a field of the form), the
// passport fields still missing, a message, or a fault.
export type AnswerRefusal =
  | { kind: "field"; message: string }
  | { kind: "profile"; missing: string[] }
  | { kind: "message"; message: string }
  | { kind: "fault" };

export function answerRefusal(error: RefusalError): AnswerRefusal {
  switch (error.message) {
    case "CHARA_INVALID_INPUT":
      return error.details === "p_document_ids" ? { kind: "field", message: SUBMISSION_MESSAGES.documents } : { kind: "fault" };
    case "CHARA_PROFILE_INCOMPLETE":
      return { kind: "profile", missing: (error.details ?? "").split(", ").filter(Boolean) };
    case "CHARA_DOCUMENT_NOT_SCANNED":
      return { kind: "message", message: SUBMISSION_MESSAGES.scanning };
    case "CHARA_CONFLICT":
      return error.details === "already_submitted" ? { kind: "message", message: SUBMISSION_MESSAGES.alreadySubmitted } : { kind: "fault" };
    case "CHARA_INVALID_STATE":
      if (error.details === "expired") return { kind: "message", message: SUBMISSION_MESSAGES.expired };
      if (error.details === "requirement_not_open") return { kind: "message", message: SUBMISSION_MESSAGES.closed };
      return { kind: "message", message: SUBMISSION_MESSAGES.answered };
    case "CHARA_NOT_FOUND":
      return { kind: "message", message: SUBMISSION_MESSAGES.requestNotFound };
    case "CHARA_FORBIDDEN":
      if (error.details === "release_off") return { kind: "message", message: SUBMISSION_MESSAGES.releaseOff };
      if (error.details === "account_not_active") return { kind: "message", message: SUBMISSION_MESSAGES.accountClosing };
      return { kind: "fault" };
    default:
      return { kind: "fault" };
  }
}

// A refusal of withdraw_submission (FR-O4 AC9). A submission already withdrawn is what the candidate asked for, so the
// caller answers it as done.
export function withdrawRefusal(error: RefusalError): { kind: "withdrawn" } | { kind: "message"; message: string } | { kind: "fault" } {
  if (error.message === "CHARA_INVALID_STATE") {
    return error.details === "withdrawn" ? { kind: "withdrawn" } : { kind: "message", message: SUBMISSION_MESSAGES.notWithdrawable };
  }
  if (error.message === "CHARA_NOT_FOUND") return { kind: "message", message: SUBMISSION_MESSAGES.notWithdrawable };
  if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { kind: "message", message: SUBMISSION_MESSAGES.releaseOff };
  return { kind: "fault" };
}
