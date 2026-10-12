"use server";

import * as z from "zod";
import { redirect } from "next/navigation";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { submitReport as storeReport } from "@/lib/dal/reports";
import { defaultLocale } from "@/lib/i18n/locale";
import { contentPathFrom, vacancyIdFrom } from "@/lib/reports/target";
import { mfaPath } from "@/lib/routes";
import { PAGE_LINK, VACANCY_LINK, reportInputSchema, type ReportInput } from "@/lib/validation/report";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

type ReportResult = { errors?: FieldErrors; message?: string; reference?: string };

const RATE_LIMITED = "You have sent several reports in a short time. Try again in a while.";
const VACANCY_NOT_PUBLIC = "This vacancy cannot be reported: it is not public. Check the address.";
const APPLICANT_NOT_FOUND = "This applicant could not be found.";
const MEMBERS_ONLY = "Only members of a company can report an applicant of that company.";

const fieldByDetail: Record<string, string> = {
  details: "details",
  email: "email",
  category: "category",
  good_faith: "goodFaith",
  job: "link",
  path: "link",
};

function resolveTarget(type: ReportInput["type"], target: string) {
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
// (a public vacancy, a company through one, a page, or an applicant of the caller's own organisation) and counts the
// attempt against the visitor throttle, so nothing here repeats those rules.
export async function submitReport(input: ReportInput): Promise<ReportResult> {
  const parsed = reportInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { type, target, category, details, email } = parsed.data;
  const resolved = resolveTarget(type, target);
  if (!resolved) return { errors: { link: type === "content" ? PAGE_LINK : VACANCY_LINK } };

  const stored = await storeReport(resolved, { category, details, email });
  if (stored.ok) return { reference: stored.reference };
  const { error } = stored;

  if (error.message === "CHARA_RATE_LIMITED") return { message: RATE_LIMITED };
  if (error.message === "CHARA_NOT_FOUND") {
    return type === "profile" ? { message: APPLICANT_NOT_FOUND } : { errors: { link: VACANCY_NOT_PUBLIC } };
  }
  if (error.message === "CHARA_FORBIDDEN") {
    if (error.details === "aal2_required") redirect(mfaPath(defaultLocale));
    // A failed proof of the throttle is also CHARA_FORBIDDEN; it is a fault of ours and is never put on a member.
    if (error.details === "sign_in_required" || (type === "profile" && error.details !== "p_proof")) return { message: MEMBERS_ONLY };
  }
  const field = error.message === "CHARA_INVALID_INPUT" && error.details ? fieldByDetail[error.details] : undefined;
  if (field) return { errors: { [field]: "Check this value." } };
  console.error("Submitting the report failed", { code: error.code, message: /^CHARA_[A-Z_]+$/.test(error.message) ? error.message : undefined });
  return { message: GENERIC_FAILURE };
}
