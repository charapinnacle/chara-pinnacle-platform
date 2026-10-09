import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "./handler.ts";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Who asked and for which request: the jobs queued by an administrator carry both, and every effect they have is
// recorded against them (FR-F2). The other jobs carry neither.
export interface Audit {
  actorId: string;
  requestId: string;
}

interface Step {
  action: string;
  entityType: string;
  entityId: string;
  data: Record<string, number>;
}

export function parseAudit(actorId: unknown, requestId: unknown): Audit | null | undefined {
  if (actorId === undefined && requestId === undefined) {
    return null;
  }
  return typeof actorId === "string" && UUID.test(actorId) && typeof requestId === "string" && UUID.test(requestId)
    ? { actorId, requestId }
    : undefined;
}

// What a job did, as the steps to record: the sessions it ended, the ban it set or lifted, the factors it deleted. A step
// that has no effect to name (a user that is gone) is not recorded.
function steps(job: Job, result: Record<string, number>): Step[] {
  const profile = (action: string, userId: string, data: Record<string, number>): Step => ({
    action,
    entityType: "profile",
    entityId: userId,
    data,
  });
  switch (job.action) {
    case "sign_out":
      return [profile("account_ops.sign_out_global", job.userId, { sessions_ended: result.sessions_ended })];
    case "reset_mfa":
      return [
        profile("account_ops.sign_out_global", job.userId, { sessions_ended: result.sessions_ended }),
        profile("account_ops.delete_factors", job.userId, { factors_deleted: result.factors_deleted }),
      ];
    case "suspend_user":
    case "reinstate_user":
      if (result.banned === 1) {
        return [
          profile("account_ops.sign_out_global", job.userId, { sessions_ended: result.sessions_ended }),
          profile("account_ops.ban_user", job.userId, {}),
        ];
      }
      return result.banned === 0 ? [profile("account_ops.unban_user", job.userId, {})] : [];
    case "sign_out_organization":
      return [{
        action: "account_ops.sign_out_organization",
        entityType: "organization",
        entityId: job.organizationId,
        data: { sessions_ended: result.sessions_ended },
      }];
    case "fan_out_legal_version":
      return [{
        action: "account_ops.fan_out_legal_version",
        entityType: "legal_document",
        entityId: `${job.documentSlug}:${job.version}`,
        data: { emails_queued: result.emails_queued },
      }];
    default:
      return [];
  }
}

// The database writes a row once per job and action, so a job that is read again after a crash (before its
// acknowledgement) records nothing twice.
export async function record(client: SupabaseClient, job: Job, result: Record<string, number>): Promise<void> {
  if (!job.audit) {
    return;
  }
  for (const step of steps(job, result)) {
    const { error } = await client.rpc("audit_record_external", {
      p_action: step.action,
      p_entity_type: step.entityType,
      p_entity_id: step.entityId,
      p_actor_id: job.audit.actorId,
      p_metadata: { ...step.data, request_id: job.audit.requestId, job_id: String(job.msgId) },
    });
    if (error) {
      throw error;
    }
  }
}
