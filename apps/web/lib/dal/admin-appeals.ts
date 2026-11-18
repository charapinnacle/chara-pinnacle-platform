import "server-only";
import { cache } from "react";
import type { Database } from "@chara-pinnacle/db-types";
import { adminClient, failure, paged, type Page } from "@/lib/dal/admin";
import { ADMIN_PAGE_SIZE } from "@/lib/validation/admin";
import type { AppealCursor, AppealListStatus } from "@/lib/validation/appeal";

type AppealStatus = Database["public"]["Enums"]["appeal_status"];

export type AppealRow = {
  id: number;
  decisionId: number;
  targetType: string;
  title: string;
  organizationName: string;
  status: AppealStatus;
  lodgedAt: string;
  dueAt: string;
  overdue: boolean;
  decidedAt: string | null;
};

// An appeal with the decision it is about, as staff read it (FR-S1): never the appellant's name. ownDecision: the staff
// member took the decision, so another administrator decides the appeal.
export type AppealDetail = {
  id: number;
  decisionId: number;
  targetType: string;
  targetId: string;
  action: string;
  title: string;
  organizationId: string;
  organizationName: string;
  decisionReasons: string;
  decidedOn: string;
  decisionReportId: number | null;
  inEffect: boolean;
  ownDecision: boolean;
  status: AppealStatus;
  grounds: string;
  lodgedAt: string;
  dueAt: string;
  overdue: boolean;
  reasons: string | null;
  decidedAt: string | null;
};

export type AppealStats = { decided: number; restored: number; open: number; overdue: number };

// Open appeals by due time, continued after the last row's due time and id; decided ones newest first after its id.
export async function listAppeals(status: AppealListStatus, after: AppealCursor | null): Promise<Page<AppealRow, AppealCursor>> {
  const open = status === "open";
  const keyset = open && after && "dueAt" in after ? after : null;
  const afterId = open ? keyset?.id : after && !("dueAt" in after) ? after.id : undefined;
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_list_appeals", {
    p_status: status,
    p_limit: ADMIN_PAGE_SIZE + 1,
    p_after_id: afterId,
    p_after_due_at: keyset?.dueAt,
  });
  if (error) throw failure("The appeals", error);
  const rows = data.map(
    (row): AppealRow => ({
      id: row.id,
      decisionId: row.moderation_action_id,
      targetType: row.target_type,
      title: row.title,
      organizationName: row.organization_name,
      status: row.status,
      lodgedAt: row.lodged_at,
      dueAt: row.due_at,
      overdue: row.overdue,
      decidedAt: row.decided_at ?? null,
    }),
  );
  return paged(rows, (row): AppealCursor => (open ? { dueAt: row.dueAt, id: row.id } : { id: row.id }));
}

// Cached per request: the page reads it to answer 404 before its Suspense boundary, and the view reads it again.
export const getAppeal = cache(async (id: number): Promise<AppealDetail | null> => {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_get_appeal", { p_id: id });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return null;
    throw failure("The appeal", error);
  }
  const [row] = data;
  return {
    id: row.id,
    decisionId: row.moderation_action_id,
    targetType: row.target_type,
    targetId: row.target_id,
    action: row.action,
    title: row.title,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    decisionReasons: row.decision_reasons,
    decidedOn: row.decided_on,
    decisionReportId: row.decision_report_id ?? null,
    inEffect: row.in_effect,
    ownDecision: row.own_decision,
    status: row.status,
    grounds: row.grounds,
    lodgedAt: row.lodged_at,
    dueAt: row.due_at,
    overdue: row.overdue,
    reasons: row.reasons ?? null,
    decidedAt: row.decided_at ?? null,
  };
});

// The KPI "Decisions reversed on appeal" of the last year, with the open and overdue appeals.
export async function getAppealStats(): Promise<AppealStats> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_appeal_stats");
  if (error) throw failure("The appeal figures", error);
  const [row] = data;
  return { decided: row.decided, restored: row.restored, open: row.open, overdue: row.overdue };
}
