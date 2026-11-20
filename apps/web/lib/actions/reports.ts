"use server";

import * as z from "zod";
import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { submitReport as storeReport } from "@/lib/dal/reports";
import { defaultLocale } from "@/lib/i18n/locale";
import { contentPathFrom, vacancyIdFrom } from "@/lib/reports/target";
import { mfaPath } from "@/lib/routes";
import { PAGE_LINK, VACANCY_LINK, isReportItem, reportInputSchema, type ReportInput } from "@/lib/validation/report";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

type ReportResult = { errors?: FieldErrors; message?: string; reference?: string };

const RATE_LIMITED = "You have sent several reports in a short time. Try again in a while.";
const VACANCY_NOT_PUBLIC = "This vacancy cannot be reported: it is not public. Check the address.";
const APPLICANT_NOT_FOUND = "This applicant could not be found.";
const MEMBERS_ONLY = "Only members of a company can report an applicant of that company.";
const PARTNER_NOT_PUBLIC = "This company profile cannot be reported: it is not public.";
const ITEM_NOT_FOUND = "This cannot be reported from your account. It may have been removed or it is not shared with you.";
const SIGN_IN_TO_REPORT = "Sign in to report this.";

const fieldByDetail: Record<string, string> = {
  details: "details",
  email: "email",
  category: "category",
  good_faith: "goodFaith",
  job: "link",
  path: "link",
};

function resolveTarget(type: ReportInput["type"], target: string) {
  if (isReportItem(type)) {
    const id = z.uuid().safeParse(target);
    if (!id.success) return null;
    if (type === "requirement") return { type, requirement: id.data } as const;
    if (type === "partner_response") return { type, response: id.data } as const;
    return { type, submission: id.data } as const;
  }
  if (type === "partner_profile") {
    const partner = slugSchema.safeParse(target);
    return partner.success ? ({ type, partner: partner.data } as const) : null;
  }
  if (type === "profile") {
    const application = z.uuid().safeParse(target);
    return application.success ? ({ type, application: application.data } as const) : null;
  }
  if (type === "content") {
    const path = contentPathFrom(target);
    return path ? ({ type, path } as const) : null;
  }
  const job = vacancyIdFrom(target);
  return job ? ({ type, job } as const) : null;
}

// Anyone may report: a visitor, a candidate, a member of a company. The database decides what can be reported by whom
// (a public vacancy, a company through one, a page, a public partner profile, an applicant of the caller's own
// organisation, or a job order, response or submission the caller takes part in) and counts the attempt against the
// visitor throttle, so nothing here repeats those rules.
export async function submitReport(input: ReportInput): Promise<ReportResult> {
  const parsed = reportInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { type, target, category, details, email } = parsed.data;
  const resolved = resolveTarget(type, target);
  if (!resolved) {
    if (isReportItem(type)) return { message: ITEM_NOT_FOUND };
    return type === "partner_profile" ? { message: PARTNER_NOT_PUBLIC } : { errors: { link: type === "content" ? PAGE_LINK : VACANCY_LINK } };
  }

  const stored = await storeReport(resolved, { category, details, email });
  if (stored.ok) return { reference: stored.reference };
  const { error } = stored;

  if (error.message === "CHARA_RATE_LIMITED") return { message: RATE_LIMITED };
  if (error.message === "CHARA_NOT_FOUND") {
    if (isReportItem(type)) return { message: ITEM_NOT_FOUND };
    if (type === "partner_profile") return { message: PARTNER_NOT_PUBLIC };
    return type === "profile" ? { message: APPLICANT_NOT_FOUND } : { errors: { link: VACANCY_NOT_PUBLIC } };
  }
  if (error.message === "CHARA_FORBIDDEN") {
    if (error.details === "aal2_required") redirect(mfaPath(defaultLocale));
    if (error.details === "sign_in_required" && isReportItem(type)) return { message: SIGN_IN_TO_REPORT };
    // A failed proof of the throttle is also CHARA_FORBIDDEN; it is a fault of ours and is never put on a member.
    if (error.details === "sign_in_required" || (type === "profile" && error.details !== "p_proof")) return { message: MEMBERS_ONLY };
  }
  const field = error.message === "CHARA_INVALID_INPUT" && error.details ? fieldByDetail[error.details] : undefined;
  if (field) return { errors: { [field]: "Check this value." } };
  console.error("Submitting the report failed", { code: error.code, message: /^CHARA_[A-Z_]+$/.test(error.message) ? error.message : undefined });
  return { message: GENERIC_FAILURE };
}
