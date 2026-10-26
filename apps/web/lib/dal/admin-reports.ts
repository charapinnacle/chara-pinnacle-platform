import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { adminClient, failure, paged, type Page } from "@/lib/dal/admin";
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
  organization: { id: string; name: string; slug: string; status: Enums["organization_status"] } | null;
  resolutionNote: string | null;
  handledAt: string | null;
  createdAt: string;
  dueAt: string;
  overdue: boolean;
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
      ? { id: row.organization_id, name: row.organization_name, slug: row.organization_slug, status: row.organization_status }
      : null,
    resolutionNote: row.resolution_note ?? null,
    handledAt: row.handled_at ?? null,
    createdAt: row.created_at,
    dueAt: row.due_at,
    overdue: row.overdue,
  };
}
