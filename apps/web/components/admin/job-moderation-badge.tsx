import type { Database } from "@chara-pinnacle/db-types";
import { StatusBadge } from "@/components/feedback/status-badge";
import { moderationLabels, moderationTones } from "@/lib/jobs/presentation";

export function JobModerationBadge({ state }: { state: Database["public"]["Enums"]["job_moderation_state"] }) {
  return <StatusBadge status={moderationTones[state]}>{moderationLabels[state]}</StatusBadge>;
}
