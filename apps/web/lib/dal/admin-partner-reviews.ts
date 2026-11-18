import "server-only";
import { cache } from "react";
import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { adminClient, failure, paged, type Page } from "@/lib/dal/admin";
import { ADMIN_PAGE_SIZE } from "@/lib/validation/admin";
import type { EvidenceStatus, LicenceStatus } from "@/lib/validation/licence-status";
import {
  infoStepSchema,
  partnerDecisionSchema,
  reviewStatusSchema,
  type InfoStep,
  type PartnerDecision,
  type QueueCursor,
  type ReviewStatus,
} from "@/lib/validation/partner-review";
import { partnerTypeSchema, type PartnerType } from "@/lib/validation/sign-up";

type Enums = Database["public"]["Enums"];

export type PartnerReviewRow = {
  id: string;
  legalName: string;
  displayName: string;
  type: PartnerType;
  country: string;
  identifier: string | null;
  identifierKind: string | null;
  website: string | null;
  status: ReviewStatus;
  submittedAt: string;
  dueAt: string;
  sameIdentifier: boolean;
};

export type PartnerReviewLicence = {
  id: string;
  country: string;
  issuingAuthority: string;
  licenceNumber: string;
  validUntil: string;
  status: LicenceStatus;
  evidence: { mime: string; sizeBytes: number; status: EvidenceStatus } | null;
};

export type PartnerReviewDecision = {
  id: number;
  decision: PartnerDecision;
  reason: string;
  infoStep: InfoStep | null;
  decidedAt: string;
  decidedByEmail: string | null;
};

export type PartnerReviewDetail = {
  id: string;
  legalName: string;
  displayName: string;
  type: PartnerType;
  organizationStatus: Enums["organization_status"];
  country: string;
  industryCode: string | null;
  website: string | null;
  description: string | null;
  identifier: string | null;
  identifierKind: string | null;
  recruitmentType: Enums["recruitment_preference"] | null;
  foundedYear: number | null;
  sizeBand: Enums["workforce_size_band"] | null;
  status: ReviewStatus;
  submittedAt: string | null;
  dueAt: string | null;
  listedAt: string | null;
  createdAt: string;
  ownerEmail: string | null;
  links: { id: string; legalName: string; displayName: string; type: Enums["organization_type"]; sameType: boolean }[];
  sourcesFrom: string[];
  servesMarkets: string[];
  occupations: string[];
  industries: string[];
  languages: string[];
  serviceTypes: Enums["partner_service_type"][];
  commitment: { current: boolean; currentVersion: number | null; acceptedVersion: number | null };
  decisions: PartnerReviewDecision[];
  licences: PartnerReviewLicence[];
};

const linksSchema = z.array(
  z.object({
    id: z.uuid(),
    legal_name: z.string(),
    display_name: z.string(),
    type: z.enum(["employer", "recruitment_company", "staffing_company"]),
    same_type: z.boolean(),
  }),
);
const geographiesSchema = z.array(z.object({ scope: z.enum(["sources_from", "serves_market"]), name: z.string() }));
const labelledSchema = z.array(z.object({ code: z.string(), label: z.string().optional(), name: z.string().optional() }));
const serviceTypesSchema = z.array(z.enum(["staffing", "temporary", "contract", "project", "permanent"]));
const commitmentSchema = z.object({
  current: z.boolean(),
  current_version: z.number().int().nullable(),
  accepted_version: z.number().int().nullable(),
});
const decisionsSchema = z.array(
  z.object({
    id: z.number().int(),
    decision: partnerDecisionSchema,
    reason: z.string(),
    info_step: infoStepSchema.nullable(),
    decided_at: z.string(),
    decided_by_email: z.string().nullable(),
  }),
);

const names = (items: z.infer<typeof labelledSchema>) => items.map((item) => item.label ?? item.name ?? item.code);

// The partners waiting for a decision, oldest submission first (the database orders them); the cursor is the submission
// time and id of the last row shown.
export async function listPartnerReviews(after: QueueCursor | null): Promise<Page<PartnerReviewRow, QueueCursor>> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_list_partner_reviews", {
    p_limit: ADMIN_PAGE_SIZE + 1,
    p_after_at: after?.at,
    p_after_id: after?.id,
  });
  if (error) throw failure("The partner reviews", error);
  const rows = data.map(
    (row): PartnerReviewRow => ({
      id: row.id,
      legalName: row.legal_name,
      displayName: row.display_name,
      type: partnerTypeSchema.parse(row.type),
      country: row.based_in_country,
      identifier: row.legal_entity_identifier ?? null,
      identifierKind: row.legal_entity_identifier_kind ?? null,
      website: row.website ?? null,
      status: reviewStatusSchema.parse(row.review_status),
      submittedAt: row.submitted_at,
      dueAt: row.due_at,
      sameIdentifier: row.same_identifier,
    }),
  );
  return paged(rows, (row) => ({ at: row.submittedAt, id: row.id }));
}

// What staff check about one partner, with its licences (admin_list_partner_licences); null when it is not a partner.
// Cached per request: the page reads it to answer 404 before its Suspense boundary, and the view reads it again.
export const getPartnerReviewDetail = cache(async (id: string): Promise<PartnerReviewDetail | null> => {
  const supabase = await adminClient();
  const [review, licences] = await Promise.all([
    supabase.rpc("admin_get_partner_review", { p_org: id }),
    supabase.rpc("admin_list_partner_licences", { p_org: id }),
  ]);
  if (review.error) {
    if (review.error.message === "CHARA_NOT_FOUND") return null;
    throw failure("The partner review", review.error);
  }
  if (licences.error) throw failure("The licences of the partner", licences.error);
  const [row] = review.data;
  if (!row) return null;
  const geographies = geographiesSchema.parse(row.geographies);
  const commitment = commitmentSchema.parse(row.commitment);
  return {
    id: row.id,
    legalName: row.legal_name,
    displayName: row.display_name,
    type: partnerTypeSchema.parse(row.type),
    organizationStatus: row.status,
    country: row.based_in_country,
    industryCode: row.industry_code ?? null,
    website: row.website ?? null,
    description: row.description ?? null,
    identifier: row.legal_entity_identifier ?? null,
    identifierKind: row.legal_entity_identifier_kind ?? null,
    recruitmentType: row.recruitment_type ?? null,
    foundedYear: row.founded_year ?? null,
    sizeBand: row.workforce_size_band ?? null,
    status: reviewStatusSchema.parse(row.review_status),
    submittedAt: row.submitted_at ?? null,
    dueAt: row.due_at ?? null,
    listedAt: row.listed_at ?? null,
    createdAt: row.created_at,
    ownerEmail: row.owner_email ?? null,
    links: linksSchema.parse(row.identifier_links).map((link) => ({
      id: link.id,
      legalName: link.legal_name,
      displayName: link.display_name,
      type: link.type,
      sameType: link.same_type,
    })),
    sourcesFrom: geographies.filter((item) => item.scope === "sources_from").map((item) => item.name),
    servesMarkets: geographies.filter((item) => item.scope === "serves_market").map((item) => item.name),
    occupations: names(labelledSchema.parse(row.occupations)),
    industries: names(labelledSchema.parse(row.industries)),
    languages: names(labelledSchema.parse(row.languages)),
    serviceTypes: serviceTypesSchema.parse(row.service_types),
    commitment: {
      current: commitment.current,
      currentVersion: commitment.current_version,
      acceptedVersion: commitment.accepted_version,
    },
    decisions: decisionsSchema.parse(row.decisions).map((decision) => ({
      id: decision.id,
      decision: decision.decision,
      reason: decision.reason,
      infoStep: decision.info_step,
      decidedAt: decision.decided_at,
      decidedByEmail: decision.decided_by_email,
    })),
    licences: licences.data.map((licence) => ({
      id: licence.id,
      country: licence.country_code,
      issuingAuthority: licence.issuing_authority,
      licenceNumber: licence.licence_number,
      validUntil: licence.valid_until,
      status: licence.status as LicenceStatus,
      evidence:
        licence.evidence_mime && licence.evidence_size_bytes && licence.evidence_scan_status
          ? {
              mime: licence.evidence_mime,
              sizeBytes: licence.evidence_size_bytes,
              status: licence.evidence_scan_status as EvidenceStatus,
            }
          : null,
    })),
  };
});
