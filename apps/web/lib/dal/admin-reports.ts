import "server-only";
import { cache } from "react";
import type { Database } from "@chara-pinnacle/db-types";
import type { PostgrestError } from "@supabase/supabase-js";
import * as z from "zod";
import { adminClient, failure, paged, type Page } from "@/lib/dal/admin";
import { feeModels } from "@/lib/responses/presentation";
import { ADMIN_PAGE_SIZE } from "@/lib/validation/admin";
import type { ReportListFilter, ReportQueueCursor } from "@/lib/validation/report";

type Enums = Database["public"]["Enums"];

type ReportRow = {
  id: number;
  reference: string;
  targetType: Enums["report_target_type"];
  targetLabel: string;
  category: Enums["report_category"];
  status: Enums["report_status"];
  priority: number;
  dueAt: string;
  overdue: boolean;
  createdAt: string;
  handledAt: string | null;
};

// A job order, response, submission (V57) or contact request (V73) as staff read it to decide: what its organisation
// wrote, never the candidate, and never the text of a request (read through the audited opening). Each field is
// optional, as each kind has its own.
const itemContextSchema = z.object({
  title: z.string().optional(),
  status: z.string().optional(),
  visibility: z.string().optional(),
  workers_needed: z.number().optional(),
  country_code: z.string().optional(),
  city_region: z.string().nullable().optional(),
  skills: z.string().nullable().optional(),
  requirement_title: z.string().optional(),
  capacity: z.number().optional(),
  available_from: z.string().optional(),
  timeline_note: z.string().nullable().optional(),
  experience_note: z.string().optional(),
  fee_model: z.enum(feeModels).optional(),
  fee_amount: z.number().nullable().optional(),
  fee_currency: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  job_title: z.string().nullable().optional(),
  destination_country: z.string().nullable().optional(),
});

export type ReportItemContext = z.output<typeof itemContextSchema>;

// The target in context: the vacancy and the organisation it belongs to, the page, or the item of the job order network
// with the organisation it affects. Never a name of a candidate.
export type ReportDetail = {
  id: number;
  reference: string;
  targetType: Enums["report_target_type"];
  category: Enums["report_category"];
  details: string;
  status: Enums["report_status"];
  reporterKind: "account" | "visitor";
  reporterEmail: string | null;
  contentPath: string | null;
  job: { id: string; title: string; status: Enums["job_status"]; moderationState: Enums["job_moderation_state"] } | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    status: Enums["organization_status"];
    type: Enums["organization_type"];
    moderationState: Enums["job_moderation_state"] | null;
  } | null;
  resolutionNote: string | null;
  handledAt: string | null;
  createdAt: string;
  dueAt: string;
  overdue: boolean;
  decisionDueAt: string;
  decision: string | null;
  item: { id: string; moderationState: Enums["job_moderation_state"] | null; context: ReportItemContext } | null;
};

export type PartnerListing = {
  id: string;
  occupation: string;
  sourceCountry: string;
  available: number;
  monthlyCapacity: number;
  availableFrom: string;
  confirmedAt: string;
  stale: boolean;
};

export type ModerationEntry = { id: number; action: string; reasons: string; at: string; reportId: number | null };

// What staff read of a partner to decide on it (FR-S1; DATA_MODEL 11.13): the state of its profile, every availability
// listing (stale ones and those of a suspended or hidden partner included) and the latest decisions.
export type PartnerModeration = {
  status: Enums["organization_status"];
  moderationState: Enums["job_moderation_state"];
  listed: boolean;
  listings: PartnerListing[];
  history: ModerationEntry[];
};

const OPEN_LISTS: readonly ReportListFilter["status"][] = ["open", "new", "in_review"];

// The open reports are listed fee demands first, then by due time (FR-S1 AC3), and continue after the whole cursor of
// the last row (priority, due time, id); the closed ones newest first after the id of the last row. The database says
// both orders; a cursor of the other shape starts the list from the top.
export async function listReports(
  filter: ReportListFilter,
  after: ReportQueueCursor | null,
): Promise<Page<ReportRow, ReportQueueCursor>> {
  const open = OPEN_LISTS.includes(filter.status);
  const keyset = open && after && "priority" in after ? after : null;
  const afterId = open ? keyset?.id : after && !("priority" in after) ? after.id : undefined;
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_list_reports", {
    p_status: filter.status,
    p_type: filter.type,
    p_limit: ADMIN_PAGE_SIZE + 1,
    p_after_id: afterId,
    p_after_priority: keyset?.priority,
    p_after_due_at: keyset?.dueAt,
  });
  if (error) throw failure("The reports", error);
  const rows = data.map(
    (row): ReportRow => ({
      id: row.id,
      reference: row.reference,
      targetType: row.target_type,
      targetLabel: row.target_label,
      category: row.category,
      status: row.status,
      priority: row.priority,
      dueAt: row.due_at,
      overdue: row.overdue,
      createdAt: row.created_at,
      handledAt: row.handled_at ?? null,
    }),
  );
  return paged(rows, (row): ReportQueueCursor => (open ? { priority: row.priority, dueAt: row.dueAt, id: row.id } : { id: row.id }));
}

// Cached per request: the page reads it to answer 404 before its Suspense boundary, and the view reads it again.
export const getReport = cache(async (id: number): Promise<ReportDetail | null> => {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_get_report", { p_id: id });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return null;
    throw failure("The report", error);
  }
  const [row] = data;
  return {
    id: row.id,
    reference: row.reference,
    targetType: row.target_type,
    category: row.category,
    details: row.details,
    status: row.status,
    reporterKind: row.reporter_kind === "account" ? "account" : "visitor",
    reporterEmail: row.reporter_email ?? null,
    contentPath: row.content_path ?? null,
    job: row.job_id
      ? { id: row.job_id, title: row.job_title, status: row.job_status, moderationState: row.job_moderation_state }
      : null,
    organization: row.organization_id
      ? {
          id: row.organization_id,
          name: row.organization_name,
          slug: row.organization_slug,
          status: row.organization_status,
          type: row.organization_type,
          moderationState: row.organization_moderation_state ?? null,
        }
      : null,
    resolutionNote: row.resolution_note ?? null,
    handledAt: row.handled_at ?? null,
    createdAt: row.created_at,
    dueAt: row.due_at,
    overdue: row.overdue,
    decisionDueAt: row.decision_due_at,
    decision: row.decision ?? null,
    item: row.item_id
      ? {
          id: row.item_id,
          moderationState: row.item_moderation_state ?? null,
          context: itemContextSchema.parse(row.item_context ?? {}),
        }
      : null,
  };
});

const listingSchema = z.object({
  id: z.string(),
  occupation: z.string(),
  source_country: z.string(),
  available: z.number(),
  monthly_capacity: z.number(),
  available_from: z.string(),
  confirmed_at: z.string(),
  stale: z.boolean(),
});

const entrySchema = z.object({
  id: z.number(),
  action: z.string(),
  reasons: z.string(),
  at: z.string(),
  report_id: z.number().nullable().optional(),
});

// Null for an employer, which has no partner profile.
export async function getPartnerModeration(organizationId: string): Promise<PartnerModeration | null> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_get_partner_moderation", { p_org: organizationId });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return null;
    throw failure("The partner", error);
  }
  const [row] = data;
  return {
    status: row.status,
    moderationState: row.moderation_state,
    listed: row.listed,
    listings: z.array(listingSchema).parse(row.listings).map((listing) => ({
      id: listing.id,
      occupation: listing.occupation,
      sourceCountry: listing.source_country,
      available: listing.available,
      monthlyCapacity: listing.monthly_capacity,
      availableFrom: listing.available_from,
      confirmedAt: listing.confirmed_at,
      stale: listing.stale,
    })),
    history: z.array(entrySchema).parse(row.history).map((entry) => ({
      id: entry.id,
      action: entry.action,
      reasons: entry.reasons,
      at: entry.at,
      reportId: entry.report_id ?? null,
    })),
  };
}

export type ReportedMessage = {
  id: string;
  createdAt: string;
  senderKind: "worker" | "organization";
  senderName: string | null;
  senderOrganizationName: string | null;
  body: string;
  reported: boolean;
};

// The reported message of a report and the five messages before and after it (FR-P3 AC7, NFR-C5), for the Trust & Safety
// Administrator handling the report; the database refuses everyone else and audits every opening, so this is read only
// when the handler asks for it, never with the page.
export async function getReportedMessage(
  reportId: number,
): Promise<{ ok: true; messages: ReportedMessage[] } | { ok: false; error: PostgrestError }> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_get_reported_message", { p_report: reportId });
  if (error) return { ok: false, error };
  return {
    ok: true,
    messages: data.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      senderKind: row.sender_kind === "worker" ? "worker" : "organization",
      senderName: row.sender_name ?? null,
      senderOrganizationName: row.sender_organization_name ?? null,
      body: row.body,
      reported: row.reported,
    })),
  };
}
