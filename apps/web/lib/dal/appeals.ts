import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { isReleased } from "@/lib/dal/release";
import { createClient } from "@/lib/supabase/server";

// A moderation decision on one of the caller's organisations that can be appealed, with its appeal (FR-S1 AC12): every
// member reads it, canAppeal is the owner's and the admins' while the window is open. Never who decided.
export type AppealableDecision = {
  id: number;
  targetType: string;
  targetId: string;
  action: string;
  title: string;
  organizationId: string;
  organizationName: string;
  orgSlug: string;
  reasons: string;
  decidedAt: string;
  appealUntil: string;
  inEffect: boolean;
  canAppeal: boolean;
  targetDays: number;
  appeal: {
    id: number;
    status: Database["public"]["Enums"]["appeal_status"];
    grounds: string;
    lodgedAt: string;
    dueAt: string;
    reasons: string | null;
    decidedAt: string | null;
  } | null;
};

// The decisions of the caller's organisations, newest first, or the one decision asked for (null when it is not one of
// theirs).
export async function listMyAppeals(): Promise<AppealableDecision[]>;
export async function listMyAppeals(decision: number): Promise<AppealableDecision | null>;
export async function listMyAppeals(decision?: number): Promise<AppealableDecision[] | AppealableDecision | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_appeals", decision === undefined ? {} : { p_action: decision });
  if (error) throw new Error("The appeals could not be loaded", { cause: error });
  const rows = data.map(
    (row): AppealableDecision => ({
      id: row.moderation_action_id,
      targetType: row.target_type,
      targetId: row.target_id,
      action: row.action,
      title: row.title,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      orgSlug: row.org_slug,
      reasons: row.reasons,
      decidedAt: row.decided_at,
      appealUntil: row.appeal_until,
      inEffect: row.in_effect,
      canAppeal: row.can_appeal,
      targetDays: row.target_days,
      appeal:
        row.appeal_id === null || row.appeal_status === null
          ? null
          : {
              id: row.appeal_id,
              status: row.appeal_status,
              grounds: row.grounds ?? "",
              lodgedAt: row.lodged_at ?? "",
              dueAt: row.due_at ?? "",
              reasons: row.appeal_reasons ?? null,
              decidedAt: row.appeal_decided_at ?? null,
            },
    }),
  );
  return decision === undefined ? rows : (rows[0] ?? null);
}

// The page of the latest decision that hid a vacancy, while release 2a is on; null before it (the Phase 1 route of the
// Complaints and Dispute Process stays) or when the decision is outside the appeal window.
export async function vacancyDecisionId(jobId: string): Promise<number | null> {
  if (!(await isReleased("release_partner_directories"))) return null;
  const decision = (await listMyAppeals()).find((item) => item.action === "job_hidden" && item.targetId === jobId);
  return decision?.id ?? null;
}
