import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { getPublicSettings } from "@/lib/dal/settings";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { toRequirementVersion, type RequirementVersion } from "@/lib/requirements/versions";
import { documentRefusals, type DocumentRefusal } from "@/lib/responses/refusal";
import {
  feeModels,
  responseFields,
  type FeeModel,
  type ResponseField,
  type ResponseStatus,
  type ResponseVersion,
} from "@/lib/responses/presentation";
import { createClient } from "@/lib/supabase/server";

type Enums = Database["public"]["Enums"];

export const MY_RESPONSES_PAGE_SIZE = 20;

// Whether and why the partner may respond to a requirement now (get_response_eligibility, FR-N2 AC1, AC4, AC12): refusal
// and detail are the error a response would raise (null when it may), with the partner's own response once it responded,
// the month's use against the limit, and the most workers it may offer.
export type ResponseEligibility = {
  requirementId: string;
  canRespond: boolean;
  refusal: string | null;
  detail: string | null;
  invited: boolean;
  responseId: string | null;
  responseStatus: ResponseStatus | null;
  used: number;
  limit: number | null;
  applies: boolean;
  resetsAt: string | null;
  maxCapacity: number | null;
  licenceMissing: string[];
};

// null when the partner may not see the requirement (CHARA_NOT_FOUND), which the page answers with the neutral 404; any
// other failure throws, and the page shows the panel's error with a retry instead of Respond (AC12).
export async function getResponseEligibility(organizationId: string, requirementId: string): Promise<ResponseEligibility | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_response_eligibility", { p_org: organizationId, p_requirement: requirementId });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return null;
    throw new Error("The response eligibility could not be loaded", { cause: error });
  }
  const [row] = data;
  if (!row) return null;
  return {
    requirementId: row.requirement_id,
    canRespond: row.can_respond,
    refusal: row.refusal ?? null,
    detail: row.detail ?? null,
    invited: row.invited,
    responseId: row.response_id ?? null,
    responseStatus: row.response_status ?? null,
    used: row.used,
    limit: row.limit_value ?? null,
    applies: row.applies,
    resetsAt: row.period_resets_at ?? null,
    maxCapacity: row.max_capacity ?? null,
    licenceMissing: row.licence_missing ?? [],
  };
}

// One response in the partner's list (list_my_responses): the requirement as the partner knows it, its own title and the
// employer only when the employer is named to the partner (NFR-S11), the generated title otherwise.
export type MyResponse = {
  id: string;
  requirementId: string;
  invitationId: string | null;
  status: ResponseStatus;
  version: number;
  capacity: number;
  availableFrom: string;
  feeModel: FeeModel;
  feeAmount: number | null;
  feeCurrency: string | null;
  createdAt: string;
  updatedAt: string;
  withdrawnAt: string | null;
  decidedAt: string | null;
  requirementStatus: Enums["requirement_status"];
  title: string;
  countryCode: string;
  workersNeeded: number;
  employerName: string | null;
};

export type MyResponsesPage = { responses: MyResponse[]; nextCursor: string | null; cursorIgnored: boolean };

// A page link that names no response of the partner (made up, or of another company) shows the first page instead.
export async function listMyResponses(organizationId: string, cursor: string | null): Promise<MyResponsesPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_responses", {
    p_org: organizationId,
    p_cursor: cursor ?? undefined,
    p_limit: MY_RESPONSES_PAGE_SIZE,
  });
  if (error) {
    if (error.message === "CHARA_INVALID_INPUT" && error.details === "p_cursor" && cursor) {
      return { ...(await listMyResponses(organizationId, null)), cursorIgnored: true };
    }
    throw new Error("The responses could not be loaded", { cause: error });
  }
  return {
    responses: data.map((row) => ({
      id: row.id,
      requirementId: row.requirement_id,
      invitationId: row.invitation_id ?? null,
      status: row.status,
      version: row.version,
      capacity: row.capacity,
      availableFrom: row.available_from,
      feeModel: row.fee_model,
      feeAmount: row.fee_amount ?? null,
      feeCurrency: row.fee_currency ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      withdrawnAt: row.withdrawn_at ?? null,
      decidedAt: row.decided_at ?? null,
      requirementStatus: row.requirement_status,
      title: row.title,
      countryCode: row.country_code,
      workersNeeded: row.workers_needed,
      employerName: row.employer_name ?? null,
    })),
    nextCursor: data.at(-1)?.next_cursor ?? null,
    cursorIgnored: false,
  };
}

// One response as get_response returns it to either party. The partner reads the requirement as it knows it
// (employerName only when named); the employer reads the partner's name and slug and updatedUnseen, and its opening marks
// the version seen (FR-O2 AC9).
export type ResponseDetail = {
  id: string;
  requirementId: string;
  invitationId: string | null;
  status: ResponseStatus;
  version: number;
  capacity: number;
  availableFrom: string;
  timelineNote: string | null;
  experienceNote: string;
  feeModel: FeeModel;
  feeAmount: number | null;
  feeCurrency: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  updatedUnseen: boolean;
  requirementStatus: Enums["requirement_status"];
  title: string;
  countryCode: string;
  workersNeeded: number;
  maxCapacity: number;
  employerName: string | null;
  partnerName: string | null;
  partnerSlug: string | null;
};

// null for another organisation's response and an unknown id (CHARA_NOT_FOUND): the page answers with the neutral 404.
export async function getResponse(organizationId: string, id: string): Promise<ResponseDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_response", { p_org: organizationId, p_response: id });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return null;
    throw new Error("The response could not be loaded", { cause: error });
  }
  const [row] = data;
  if (!row) return null;
  return {
    id: row.id,
    requirementId: row.requirement_id,
    invitationId: row.invitation_id ?? null,
    status: row.status,
    version: row.version,
    capacity: row.capacity,
    availableFrom: row.available_from,
    timelineNote: row.timeline_note ?? null,
    experienceNote: row.experience_note,
    feeModel: row.fee_model,
    feeAmount: row.fee_amount ?? null,
    feeCurrency: row.fee_currency ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at ?? null,
    withdrawnAt: row.withdrawn_at ?? null,
    withdrawalReason: row.withdrawal_reason ?? null,
    updatedUnseen: row.updated_unseen ?? false,
    requirementStatus: row.requirement_status,
    title: row.title,
    countryCode: row.country_code,
    workersNeeded: row.workers_needed,
    maxCapacity: row.max_capacity,
    employerName: row.employer_name ?? null,
    partnerName: row.partner_name ?? null,
    partnerSlug: row.partner_slug ?? null,
  };
}

// One response to a requirement of the employer (list_requirement_responses, FR-O2 AC9, FR-N2 AC9): Updated until it is
// opened, Withdrawn with the date and the reason.
export type RequirementResponse = {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerSlug: string | null;
  invitationId: string | null;
  status: ResponseStatus;
  version: number;
  updatedUnseen: boolean;
  capacity: number;
  availableFrom: string;
  feeModel: FeeModel;
  feeAmount: number | null;
  feeCurrency: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
};

// The page reads the requirement first, so any refusal here is an error for the route's boundary.
export async function listRequirementResponses(organizationId: string, requirementId: string): Promise<RequirementResponse[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_requirement_responses", { p_org: organizationId, p_requirement: requirementId });
  if (error) throw new Error("The responses to the requirement could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    partnerId: row.organization_id,
    partnerName: row.partner_name,
    partnerSlug: row.partner_slug ?? null,
    invitationId: row.invitation_id ?? null,
    status: row.status,
    version: row.version,
    updatedUnseen: row.updated_unseen,
    capacity: row.capacity,
    availableFrom: row.available_from,
    feeModel: row.fee_model,
    feeAmount: row.fee_amount ?? null,
    feeCurrency: row.fee_currency ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at ?? null,
    withdrawnAt: row.withdrawn_at ?? null,
    withdrawalReason: row.withdrawal_reason ?? null,
  }));
}

const payloadSchema = z.object({
  capacity: z.number().nullish(),
  available_from: z.string().nullish(),
  timeline_note: z.string().nullish(),
  experience_note: z.string().nullish(),
  fee_model: z.enum(feeModels).nullish(),
  fee_amount: z.number().nullish(),
  fee_currency: z.string().nullish(),
  notes: z.string().nullish(),
});

function changedFields(fields: string[]): ResponseField[] {
  return responseFields.filter((field) => fields.includes(field));
}

// The versions of a response, newest first, for either party (FR-O2 AC8, AC9).
export async function listResponseVersions(organizationId: string, id: string): Promise<ResponseVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_response_versions", { p_org: organizationId, p_response: id });
  if (error) throw new Error("The versions of the response could not be loaded", { cause: error });
  return data.map((row) => {
    const payload = payloadSchema.parse(row.payload);
    return {
      version: row.version,
      createdAt: row.created_at,
      changedFields: changedFields(row.changed_fields ?? []),
      payload: {
        capacity: payload.capacity ?? null,
        availableFrom: payload.available_from ?? null,
        timelineNote: payload.timeline_note ?? null,
        experienceNote: payload.experience_note ?? null,
        feeModel: payload.fee_model ?? null,
        feeAmount: payload.fee_amount ?? null,
        feeCurrency: payload.fee_currency ?? null,
        notes: payload.notes ?? null,
      },
    };
  });
}

// The employer's changes to the requirement since the partner responded, newest first, never who made them; the
// values of the title, skills and city are left out while the employer is not named (FR-M2 step Edit, NFR-S11).
export async function listResponseChanges(organizationId: string, id: string): Promise<RequirementVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_response_changes", { p_org: organizationId, p_response: id });
  if (error) throw new Error("The changes of the requirement could not be loaded", { cause: error });
  return data.map(toRequirementVersion);
}

export const documentScanStatuses = ["pending", "skipped", "clean", "rejected"] as const;
export type DocumentScanStatus = (typeof documentScanStatuses)[number];

// A supporting document of a response (V45): the partner's members read every own file, staged or attached; the
// employer's members only the scanned files of a response to their requirement. The object path, the uploader and the
// employer are not granted.
export type ResponseDocument = {
  id: string;
  responseId: string | null;
  fileName: string;
  sizeBytes: number;
  scanStatus: DocumentScanStatus;
  createdAt: string;
};

const scanStatusSchema = z.enum(documentScanStatuses);

// The files of one response, or the partner's files for a requirement it has not responded to yet (staged), oldest first.
export async function listResponseDocuments(
  target: { responseId: string } | { organizationId: string; requirementId: string },
): Promise<ResponseDocument[]> {
  const supabase = await createClient();
  let query = supabase
    .from("partner_response_documents")
    .select("id, response_id, file_name, size_bytes, scan_status, created_at")
    .order("created_at")
    .order("id");
  query =
    "responseId" in target
      ? query.eq("response_id", target.responseId)
      : query.eq("organization_id", target.organizationId).eq("requirement_id", target.requirementId);
  const { data, error } = await query;
  if (error) throw new Error("The documents of the response could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    responseId: row.response_id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    scanStatus: scanStatusSchema.parse(row.scan_status),
    createdAt: row.created_at,
  }));
}

// How many documents one response takes (response_documents_max, decision 3.3, an administrator setting).
export async function getResponseDocumentsMax(): Promise<number> {
  const value = Number((await getPublicSettings()).response_documents_max);
  return Number.isInteger(value) && value > 0 ? value : 5;
}

const uploadSchema = z.object({ path: z.string().min(1), token: z.string().min(1), documentId: z.uuid() });
const linkSchema = z.object({ url: z.url({ protocol: /^https?$/ }) });
const refusalSchema = z.object({ error: z.enum(documentRefusals) });

export type DocumentUpload = { path: string; token: string; documentId: string } | { refusal: DocumentRefusal };
export type DocumentLink = { url: string } | { refusal: DocumentRefusal };

// The document-url function runs register_response_document or response_document_access_grant with the member's own
// token: who may add or open a file, its type, size and name, the limits and the scan state are the database's. The
// function is the only holder of the key that signs; this server only forwards the session.
async function callDocumentUrl<T>(body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T | { refusal: DocumentRefusal }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { refusal: "unauthorized" };
  const endpoint = serverEnv().DOCUMENT_URL_ENDPOINT ?? `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/document-url`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { refusal: "unavailable" };
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const refusal = refusalSchema.safeParse(json);
    return { refusal: refusal.success ? refusal.data.error : "unavailable" };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : { refusal: "unavailable" };
}

// An upload URL for one PDF on the requirement: staged until the partner responds, or on its live response at once.
export async function requestResponseDocumentUpload(
  organizationId: string,
  requirementId: string,
  file: { name: string; type: string; size: number },
): Promise<DocumentUpload> {
  return callDocumentUrl(
    { organizationId, requirementId, fileName: file.name, mime: file.type, size: file.size, purpose: "response_document_upload" },
    uploadSchema,
  );
}

// A 60-second download link to a scanned document; the opening is logged by the database (response_document.opened).
export async function requestResponseDocumentLink(documentId: string): Promise<DocumentLink> {
  return callDocumentUrl({ responseDocumentId: documentId, purpose: "response_document" }, linkSchema);
}

// How many per cent above the workers needed partners may offer on a requirement of the employer (FR-O2 AC4), read
// under the member policy of workforce_requirements; null for another organisation's requirement.
export async function getCapacityTolerance(organizationId: string, requirementId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workforce_requirements")
    .select("max_capacity_over_percent")
    .eq("organization_id", organizationId)
    .eq("id", requirementId)
    .maybeSingle();
  if (error) throw new Error("The capacity tolerance could not be loaded", { cause: error });
  return data?.max_capacity_over_percent ?? null;
}
