import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { adminClient, failure, paged, type Page } from "@/lib/dal/admin";
import { ADMIN_PAGE_SIZE } from "@/lib/validation/admin";
import type { ReportListFilter } from "@/lib/validation/report";

type Enums = Database["public"]["Enums"];

export type ReportRow = {
  id: number;
  reference: string;
  targetType: Enums["report_target_type"];
  targetLabel: string;
  category: Enums["report_category"];
  status: Enums["report_status"];
  createdAt: string;
  handledAt: string | null;
};

// The target in context: the vacancy and the organisation it belongs to, or the page. Never a name of a candidate.
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
  organization: { id: string; name: string; status: Enums["organization_status"] } | null;
  resolutionNote: string | null;
  handledAt: string | null;
  createdAt: string;
};

// The open reports are listed oldest first and the closed ones newest first (the database says so), and the cursor is the
// id of the last row either way.
export async function listReports(filter: ReportListFilter, after: number | null): Promise<Page<ReportRow, number>> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_list_reports", {
    p_status: filter.status,
    p_type: filter.type,
    p_limit: ADMIN_PAGE_SIZE + 1,
    p_after_id: after ?? undefined,
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
      createdAt: row.created_at,
      handledAt: row.handled_at ?? null,
    }),
  );
  return paged(rows, (row) => row.id);
}

export async function getReport(id: number): Promise<ReportDetail | null> {
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
      ? { id: row.organization_id, name: row.organization_name, status: row.organization_status }
      : null,
    resolutionNote: row.resolution_note ?? null,
    handledAt: row.handled_at ?? null,
    createdAt: row.created_at,
  };
}
