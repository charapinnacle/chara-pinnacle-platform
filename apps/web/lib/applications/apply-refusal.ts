import { NOT_ACCEPTING, profileFields } from "@/lib/applications/presentation";
import { settingsPath } from "@/lib/routes";
import type { FieldErrors } from "@/lib/validation/sign-up";

// Every reason apply_to_job or the apply action can refuse an application for, in the terms the candidate can act on (D89).
export type ApplyRefusal =
  | { kind: "not_open" }
  | { kind: "profile_incomplete"; missing: string[] }
  | { kind: "rate_limited"; retryAfterSeconds: number | null }
  | { kind: "document_not_found" }
  | { kind: "not_candidate" }
  | { kind: "account_inactive" }
  | { kind: "invalid_input"; field: "coverNote" | "documentIds" }
  | { kind: "fault"; reference: string };

export type RefusalLink = { label: string; href: string };

export type ApplyActionResult = { errors?: FieldErrors; message?: string; notOpen?: boolean; links?: RefusalLink[] };

function inWords(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function waitText(seconds: number | null): string {
  if (seconds === null) return "later";
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function applyRefusalResult(refusal: ApplyRefusal, lang: string): ApplyActionResult {
  switch (refusal.kind) {
    case "not_open":
      return { message: NOT_ACCEPTING, notOpen: true };
    case "profile_incomplete": {
      const fields = refusal.missing.flatMap((name) => (profileFields[name] ? [profileFields[name]] : []));
      if (fields.length === 0) {
        return { message: "Complete your passport before you apply.", links: [{ label: "Open your passport", href: `/${lang}/passport` }] };
      }
      return {
        message: `Add your ${inWords(fields.map(({ label }) => label.toLowerCase()))} to your passport before you apply.`,
        links: fields.map(({ label, section }) => ({ label: `Add your ${label.toLowerCase()}`, href: `/${lang}/passport#${section}` })),
      };
    }
    case "rate_limited":
      return { message: `You have sent many applications in a short time. Try again ${waitText(refusal.retryAfterSeconds)}.` };
    case "document_not_found":
      return { message: "One of the selected documents is no longer available. Reload the page and choose again." };
    case "not_candidate":
      return { message: "Only an active candidate account can apply." };
    case "account_inactive":
      return {
        message: "Your account is being closed, so you cannot apply. Cancel the closure in your settings to apply again.",
        links: [{ label: "Go to settings", href: settingsPath(lang) }],
      };
    case "invalid_input":
      return refusal.field === "coverNote"
        ? { errors: { coverNote: "Your cover note is too long. Shorten it and submit again." } }
        : { errors: { documentIds: "You selected too many documents. Choose fewer and submit again." } };
    case "fault":
      return { message: `Applications are temporarily unavailable. Please try again later. Reference: ${refusal.reference}.` };
  }
}
