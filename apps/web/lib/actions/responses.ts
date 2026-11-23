"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import type { UsagePrompt } from "@/lib/billing/limits";
import { getCountries } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import {
  getResponse,
  getResponseDocumentsMax,
  listResponseDocuments,
  requestResponseDocumentLink,
  requestResponseDocumentUpload,
  type ResponseDocument,
} from "@/lib/dal/responses";
import { requireOrgRole } from "@/lib/dal/session";
import { getUsagePrompts } from "@/lib/dal/usage";
import { getPartnerKind } from "@/lib/dal/workforce-offer";
import { env } from "@/lib/env";
import { faultMessage, logFault } from "@/lib/fault";
import { defaultLocale } from "@/lib/i18n/locale";
import { reportQuotaRefused } from "@/lib/quota-refused";
import { documentsLimitText, responseDecisions, type PartnerKind, type ResponseDecision } from "@/lib/responses/presentation";
import {
  decisionRefusal,
  documentRefusalMessage,
  RESPONSE_LIMIT_KEY,
  RESPONSE_MESSAGES,
  responseRefusal,
  withdrawRefusal,
  type ResponseRefusal,
} from "@/lib/responses/refusal";
import {
  invitationsPath,
  jobOrderPath,
  requirementPath,
  requirementResponsePath,
  requirementResponsesComparePath,
  requirementResponsesPath,
  responsePath,
  responsesPath,
} from "@/lib/routes";
import { REQUIREMENT_MESSAGES } from "@/lib/requirements/refusal";
import { createClient } from "@/lib/supabase/server";
import {
  decisionFormSchema,
  documentFileIssue,
  responseFormSchema,
  toleranceFormSchema,
  toResponseArgs,
  toResponseTermsArgs,
  withdrawFormSchema,
  type DecisionFormInput,
  type DocumentFile,
  type KeptValues,
  type ResponseFormInput,
  type ResponseFormValues,
  type ToleranceFormInput,
  type WithdrawFormInput,
} from "@/lib/validation/response";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import { slugSchema } from "@/lib/validation/team";

const idSchema = z.uuid();
const editTargetSchema = z.object({ responseId: z.uuid(), expectedVersion: z.number().int().min(1) });
const fileSchema = z.object({ name: z.string().max(200), size: z.number().int().min(0), type: z.string().max(100) });

// The server parses the form with no capacity bound: the most the partner may offer is the database's to check at the
// moment of the write (capacity_above_allowed names it), so a tolerance the employer changed meanwhile is honoured. The
// schema is built per call, so "today" is the day of the request; an edit keeps the stored capacity and date as
// update_response does.
function serverSchema(kind: PartnerKind, kept?: KeptValues) {
  return responseFormSchema({ maxCapacity: Number.MAX_SAFE_INTEGER, kind, kept });
}

export type ResponseResult = {
  errors?: FieldErrors;
  message?: string;
  responseId?: string;
  limitReached?: UsagePrompt;
  // The response is saved but its skills and fee terms are not.
  termsMessage?: string;
};

// The recruitment or staffing company of the address, for any accepted member (no aal2, FR-N2 and FR-O2 roles) while
// release 2b is on; the functions check all of it again.
async function respondingPartner(slug: string) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  if (!(await isReleased("release_job_orders"))) return "release_off" as const;
  const { organization } = await requireOrgRole(defaultLocale, parsed.data, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  return organization;
}

function revalidateResponse(slug: string, requirementId: string | null, responseId: string | null): void {
  revalidatePath(responsesPath(defaultLocale, slug));
  if (responseId) revalidatePath(responsePath(defaultLocale, slug, responseId));
  if (requirementId) revalidatePath(jobOrderPath(defaultLocale, slug, requirementId));
  revalidatePath(invitationsPath(defaultLocale, slug));
}

// A refusal as the form shows it: at its field, as the upgrade prompt of the monthly limit (read after the refusal with
// how the higher plans compare; without it the limit in words), the destination that needs a licence by name, or a
// message; anything unexpected is logged with a reference.
async function refusalResult(
  organization: { id: string; type: "employer" | "recruitment_company" | "staffing_company" },
  refusal: ResponseRefusal,
  error: { code?: string; message: string; details?: string | null },
  action: string,
): Promise<ResponseResult> {
  switch (refusal.kind) {
    case "field":
      return { errors: { [refusal.field]: refusal.message } };
    case "limit": {
      const prompts = await getUsagePrompts(organization.id, organization.type, [RESPONSE_LIMIT_KEY]).catch(() => null);
      const prompt = prompts?.[RESPONSE_LIMIT_KEY];
      return prompt ? { limitReached: prompt } : { message: "Your plan's limit of responses this month is reached." };
    }
    case "licence": {
      const countries = await getCountries().catch(() => []);
      const name = countries.find(({ code }) => code === refusal.country)?.name ?? refusal.country;
      return { message: `A licence for ${name} is required to respond to this job order.` };
    }
    case "message":
      if (error.message === "CHARA_RATE_LIMITED") reportQuotaRefused("audited_write", "response");
      return { message: refusal.message };
    case "fault":
      return { message: faultMessage(logFault(action, error)) };
  }
}

const TERMS_NOT_SAVED =
  "Your response is saved, but the skills and fee terms were not. Open the response and change it to add them again.";

// The terms beside the response (public.response_terms), saved once the response itself is: a failure here keeps the
// response and says the terms are missing, with a reference in the log.
async function saveTerms(organizationId: string, responseId: string, values: ResponseFormValues): Promise<{ termsMessage?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_response_terms", {
    p_org: organizationId,
    p_response: responseId,
    ...toResponseTermsArgs(values),
  });
  if (!error) return {};
  logFault("Saving the response terms", error);
  return { termsMessage: TERMS_NOT_SAVED };
}

// Sends the partner's response to a job order or an invitation (FR-N2 step Respond, FR-O2 step Submit, AC1, AC3 to
// AC5): respond_to_invitation checks the eligibility, the proposal and the staged documents again, writes version 1 and
// tells the employer. A second submission is refused by the database (already_responded), so it writes nothing.
export async function respondToRequirement(slug: string, requirementId: string, input: ResponseFormInput): Promise<ResponseResult> {
  const id = idSchema.safeParse(requirementId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const organization = await respondingPartner(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RESPONSE_MESSAGES.releaseOff };
  const parsed = serverSchema(await getPartnerKind(organization)).safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_to_invitation", {
    p_org: organization.id,
    p_requirement: id.data,
    ...toResponseArgs(parsed.data),
  });
  // A refusal writes nothing, and revalidating would re-render the page into its limit panel in place of the form
  // whose entries the refusal keeps (FR-R1 AC11).
  if (error) return refusalResult(organization, responseRefusal(error), error, "Sending the response");
  const terms = await saveTerms(organization.id, data, parsed.data);
  revalidateResponse(organization.slug, id.data, data);
  return { responseId: data, ...terms };
}

// Saves an edit of a live response (FR-O2 step Edit, AC8): update_response writes the next version, or nothing when
// nothing changed, and refuses an edit made from an older version than the current one (stale).
export async function updateMyResponse(
  slug: string,
  target: { responseId: string; expectedVersion: number },
  input: ResponseFormInput,
): Promise<ResponseResult> {
  const parsedTarget = editTargetSchema.safeParse(target);
  if (!parsedTarget.success) return { message: GENERIC_FAILURE };
  const organization = await respondingPartner(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RESPONSE_MESSAGES.releaseOff };
  const { responseId, expectedVersion } = parsedTarget.data;
  const current = await getResponse(organization.id, responseId);
  if (!current) return { message: RESPONSE_MESSAGES.responseNotFound };
  const parsed = serverSchema(await getPartnerKind(organization), {
    capacity: current.capacity,
    availableFrom: current.availableFrom,
  }).safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_response", {
    p_org: organization.id,
    p_response: responseId,
    p_expected_version: expectedVersion,
    ...toResponseArgs(parsed.data),
  });
  // A refusal writes nothing, and the form keeps what was entered and the files (a document still being checked or
  // sent above all).
  if (error) return refusalResult(organization, responseRefusal(error), error, "Changing the response");
  const terms = await saveTerms(organization.id, responseId, parsed.data);
  revalidateResponse(organization.slug, null, responseId);
  return { responseId, ...terms };
}

export type WithdrawResult = { errors?: FieldErrors; message?: string; done?: boolean };

// Withdraws a live response with an optional reason the employer reads (FR-N2 step Withdraw, AC8), after the
// confirmation of the page. The response still counts against the month and cannot be sent again.
export async function withdrawMyResponse(slug: string, responseId: string, input: WithdrawFormInput): Promise<WithdrawResult> {
  const id = idSchema.safeParse(responseId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const parsed = withdrawFormSchema.safeParse(input);
  if (!parsed.success) return { errors: { reason: RESPONSE_MESSAGES.reason } };
  const organization = await respondingPartner(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RESPONSE_MESSAGES.releaseOff };

  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_response", {
    p_org: organization.id,
    p_response: id.data,
    p_reason: parsed.data.reason === "" ? undefined : parsed.data.reason,
  });
  revalidateResponse(organization.slug, null, id.data);
  if (!error) return { done: true };
  const refusal = withdrawRefusal(error);
  if (refusal.kind === "field") return { errors: { reason: refusal.message } };
  if (refusal.kind === "message") {
    if (error.message === "CHARA_RATE_LIMITED") reportQuotaRefused("audited_write", "response");
    return { message: refusal.message };
  }
  return { message: faultMessage(logFault("Withdrawing the response", error)) };
}

export type DocumentUploadResult = { message?: string; upload?: { url: string; documentId: string } };

const RESPONSE_BUCKET = "partner-response-documents";

// The upload URL for one supporting PDF (FR-O2 step Attach, AC5): the browser then sends the file straight to Storage,
// so no file passes through a Next.js request. The form checks the type, size, name and count first; the database checks
// them again with the conditions of a response and the documents limit.
export async function startResponseDocumentUpload(slug: string, requirementId: string, file: DocumentFile): Promise<DocumentUploadResult> {
  const id = idSchema.safeParse(requirementId);
  const parsedFile = fileSchema.safeParse(file);
  if (!id.success || !parsedFile.success) return { message: GENERIC_FAILURE };
  const organization = await respondingPartner(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RESPONSE_MESSAGES.releaseOff };
  const max = await getResponseDocumentsMax();
  const issue = documentFileIssue(parsedFile.data, 0, max);
  if (issue) return { message: issue };
  const upload = await requestResponseDocumentUpload(organization.id, id.data, parsedFile.data);
  if ("refusal" in upload) return { message: documentRefusalMessage(upload.refusal, documentsLimitText(max)) };
  // The address supabase-js builds for uploadToSignedUrl; the form sends the bytes there itself to show the progress.
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/${RESPONSE_BUCKET}/${upload.path}?token=${encodeURIComponent(upload.token)}`;
  return { upload: { url, documentId: upload.documentId } };
}

export type DocumentListResult = { message?: string; documents?: ResponseDocument[] };

// The partner's files for the requirement, staged or on its response, as the form follows their scan.
export async function readResponseDocuments(slug: string, requirementId: string): Promise<DocumentListResult> {
  const id = idSchema.safeParse(requirementId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const organization = await respondingPartner(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RESPONSE_MESSAGES.releaseOff };
  try {
    return { documents: await listResponseDocuments({ organizationId: organization.id, requirementId: id.data }) };
  } catch {
    return { message: "The documents could not be loaded. Try again in a moment." };
  }
}

// Removes a staged file, or a file of the live response (V45 remove_response_document); the file goes from Storage too.
export async function removeResponseDocument(slug: string, documentId: string): Promise<{ message?: string }> {
  const id = idSchema.safeParse(documentId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const organization = await respondingPartner(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RESPONSE_MESSAGES.releaseOff };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_response_document", { p_org: organization.id, p_document: id.data });
  if (!error || error.code === "P0002") return {};
  if (error.message === "CHARA_INVALID_STATE") return { message: documentRefusalMessage("invalid_state", "") };
  if (error.message === "CHARA_RATE_LIMITED") {
    reportQuotaRefused("audited_write", "response");
    return { message: RESPONSE_MESSAGES.tooManyChanges };
  }
  return { message: faultMessage(logFault("Removing the response document", error)) };
}

export type DocumentLinkResult = { message?: string; url?: string };

// A 60-second link that makes the browser save a scanned document, for the partner's members and the employer's
// members alike (FR-O2 AC6); the opening is logged by the database.
export async function openResponseDocument(slug: string, documentId: string): Promise<DocumentLinkResult> {
  const id = idSchema.safeParse(documentId);
  const parsedSlug = slugSchema.safeParse(slug);
  if (!id.success || !parsedSlug.success) return { message: GENERIC_FAILURE };
  if (!(await isReleased("release_job_orders"))) return { message: RESPONSE_MESSAGES.releaseOff };
  await requireOrgRole(defaultLocale, parsedSlug.data, "member", { mfa: false, hideFromOutsiders: true, partner: "either" });
  const link = await requestResponseDocumentLink(id.data);
  if ("url" in link) return { url: link.url };
  return { message: documentRefusalMessage(link.refusal, "") };
}

export type ToleranceResult = { errors?: FieldErrors; message?: string; changed?: boolean };

// How many per cent above the workers needed partners may offer (FR-O2 AC4, data: set by the employer), for an owner or
// admin at aal2 of the employer; responses already sent keep their capacity.
export async function setCapacityTolerance(slug: string, requirementId: string, input: ToleranceFormInput): Promise<ToleranceResult> {
  const id = idSchema.safeParse(requirementId);
  const parsedSlug = slugSchema.safeParse(slug);
  if (!id.success || !parsedSlug.success) return { message: GENERIC_FAILURE };
  const parsed = toleranceFormSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (!(await isReleased("release_job_orders"))) return { message: RESPONSE_MESSAGES.releaseOff };
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "admin", { hideFromOutsiders: true });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_requirement_capacity_tolerance", {
    p_org: organization.id,
    p_requirement: id.data,
    p_percent: Number(parsed.data.percent),
  });
  revalidatePath(requirementPath(defaultLocale, organization.slug, id.data));
  revalidatePath(requirementResponsesPath(defaultLocale, organization.slug, id.data));
  if (!error) return { changed: data };
  if (error.message === "CHARA_INVALID_INPUT") return { errors: { percent: "Enter a whole number from 0 to 100." } };
  if (error.message === "CHARA_INVALID_STATE" && error.details === "hidden") return { message: REQUIREMENT_MESSAGES.hidden };
  if (error.message === "CHARA_INVALID_STATE") return { message: "The requirement is closed, so the tolerance can no longer be changed." };
  if (error.message === "CHARA_NOT_FOUND" || error.code === "P0002") return { message: "This requirement could not be found. Reload the page." };
  if (error.message === "CHARA_RATE_LIMITED") {
    reportQuotaRefused("audited_write", "requirement");
    return { message: RESPONSE_MESSAGES.tooManyChanges };
  }
  if (error.message === "CHARA_FORBIDDEN") return { message: "You are not allowed to change this requirement." };
  return { message: faultMessage(logFault("Setting the capacity tolerance", error)) };
}


export type DecisionResult = { errors?: FieldErrors; message?: string; done?: boolean };

const decisionSchema = z.enum(responseDecisions);

// The employer's owner or admin at aal2 (the functions check it again), while release 2b is on.
async function decidingEmployer(slug: string) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  if (!(await isReleased("release_job_orders"))) return "release_off" as const;
  const { organization } = await requireOrgRole(defaultLocale, parsed.data, "admin", { hideFromOutsiders: true });
  return organization;
}

function revalidateDecision(slug: string, requirementId: string, responseId: string): void {
  revalidatePath(requirementPath(defaultLocale, slug, requirementId));
  revalidatePath(requirementResponsesPath(defaultLocale, slug, requirementId));
  revalidatePath(requirementResponsesComparePath(defaultLocale, slug, requirementId));
  revalidatePath(requirementResponsePath(defaultLocale, slug, requirementId, responseId));
}

function decisionFailure(error: { code?: string; message: string; details?: string | null }, action: string): DecisionResult {
  const refusal = decisionRefusal(error);
  if (refusal.kind === "field") return { errors: { note: refusal.message } };
  if (refusal.kind === "message") {
    if (error.message === "CHARA_RATE_LIMITED") reportQuotaRefused("audited_write", "response");
    return { message: refusal.message };
  }
  return { message: faultMessage(logFault(action, error)) };
}

// Shortlists, selects or declines a response with an optional note to the partner (FR-O3 steps Decide, Reveal, Inform,
// Open submissions; AC3 to AC5, AC10), after the confirmation of the page. decide_response checks the role, the
// requirement and the move again, reveals the employer on a shortlist or selection and tells the partner.
export async function decideResponse(
  slug: string,
  target: { requirementId: string; responseId: string },
  decision: ResponseDecision,
  input: DecisionFormInput,
): Promise<DecisionResult> {
  const requirement = idSchema.safeParse(target.requirementId);
  const response = idSchema.safeParse(target.responseId);
  const parsedDecision = decisionSchema.safeParse(decision);
  if (!requirement.success || !response.success || !parsedDecision.success) return { message: GENERIC_FAILURE };
  const parsed = decisionFormSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const organization = await decidingEmployer(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RESPONSE_MESSAGES.releaseOff };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_response", {
    p_org: organization.id,
    p_response: response.data,
    p_decision: parsedDecision.data,
    p_note: parsed.data.note === "" ? undefined : parsed.data.note,
  });
  revalidateDecision(organization.slug, requirement.data, response.data);
  if (!error) return { done: true };
  return decisionFailure(error, "Deciding the response");
}

// Opens or closes candidate submissions for a shortlisted partner (FR-O3 step Open submissions, AC8); a selection opens
// them by itself.
export async function setResponseSubmissions(
  slug: string,
  target: { requirementId: string; responseId: string },
  allowed: boolean,
): Promise<DecisionResult> {
  const requirement = idSchema.safeParse(target.requirementId);
  const response = idSchema.safeParse(target.responseId);
  if (!requirement.success || !response.success || typeof allowed !== "boolean") return { message: GENERIC_FAILURE };
  const organization = await decidingEmployer(slug);
  if (organization === null) return { message: GENERIC_FAILURE };
  if (organization === "release_off") return { message: RESPONSE_MESSAGES.releaseOff };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_submissions_allowed", {
    p_org: organization.id,
    p_response: response.data,
    p_allowed: allowed,
  });
  revalidateDecision(organization.slug, requirement.data, response.data);
  if (!error) return { done: true };
  return decisionFailure(error, "Changing the candidate submissions of the response");
}
