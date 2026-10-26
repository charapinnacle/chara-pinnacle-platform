import "server-only";
import * as z from "zod";
import { getPublicSettings } from "@/lib/dal/settings";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import {
  parseLicencePatterns,
  sortLicences,
  type EvidenceStatus,
  type LicenceStatus,
} from "@/lib/validation/licences";

export type PartnerLicence = {
  id: string;
  country: string;
  issuingAuthority: string;
  licenceNumber: string;
  validUntil: string;
  status: LicenceStatus;
  evidence: { mime: string; sizeBytes: number; status: EvidenceStatus } | null;
};

// The licence entries of a partner as its members read them (FR-J2): every column but the evidence path, which the
// column grant withholds. Expired entries first.
export async function getPartnerLicences(organizationId: string): Promise<PartnerLicence[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("partner_licences")
    .select(
      "id, country_code, issuing_authority, licence_number, valid_until, status, evidence_mime, evidence_size_bytes, evidence_scan_status",
    )
    .eq("organization_id", organizationId);
  if (error) throw new Error("The licences of the organisation could not be loaded", { cause: error });
  return sortLicences(
    data.map((row) => ({
      id: row.id,
      country: row.country_code,
      issuingAuthority: row.issuing_authority,
      licenceNumber: row.licence_number,
      validUntil: row.valid_until,
      status: row.status as LicenceStatus,
      evidence:
        row.evidence_mime && row.evidence_size_bytes && row.evidence_scan_status
          ? { mime: row.evidence_mime, sizeBytes: row.evidence_size_bytes, status: row.evidence_scan_status as EvidenceStatus }
          : null,
    })),
  );
}

// The number formats per country and the date bound of the licence form, from the public settings.
export async function getLicenceSettings(): Promise<{ patterns: Record<string, string>; maxYears: number }> {
  const settings = await getPublicSettings();
  return {
    patterns: parseLicencePatterns(settings.licence_number_patterns),
    maxYears: Number(settings.licence_valid_until_max_years),
  };
}

const uploadSchema = z.object({ path: z.string().min(1), token: z.string().min(1) });
const linkSchema = z.object({ url: z.url({ protocol: /^https?$/ }) });

type Refusal = "invalid_file" | "unavailable" | "not_scanned" | "rate_limited" | "failed";
export type EvidenceUpload = { path: string; token: string } | { refusal: Refusal };
export type EvidenceLink = { url: string } | { refusal: Refusal };

// The document-url function runs partner_document_access_grant with the member's own token: the role, aal2, the type and
// size of a file, the scan state and the reserved object name are the database's. The function is the only holder of the
// key that signs; this server only forwards the session.
async function callDocumentUrl<T>(body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T | { refusal: Refusal }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { refusal: "failed" };
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
    return { refusal: "failed" };
  }
  if (response.status === 400) return { refusal: "invalid_file" };
  if (response.status === 403 || response.status === 404) return { refusal: "unavailable" };
  if (response.status === 409) return { refusal: "not_scanned" };
  if (response.status === 429) return { refusal: "rate_limited" };
  const parsed = response.ok ? schema.safeParse(await response.json().catch(() => null)) : null;
  return parsed?.success ? parsed.data : { refusal: "failed" };
}

// An upload URL for the evidence of a licence (owner or admin at aal2).
export async function requestEvidenceUpload(licenceId: string, file: { type: string; size: number }): Promise<EvidenceUpload> {
  return callDocumentUrl({ licenceId, purpose: "evidence_upload", mime: file.type, size: file.size }, uploadSchema);
}

// A 60-second download link to the scanned evidence of a licence of the own organisation (owner or admin at aal2).
export async function requestEvidenceLink(licenceId: string): Promise<EvidenceLink> {
  return callDocumentUrl({ licenceId, purpose: "evidence_owner" }, linkSchema);
}
