import type { Database } from "@chara-pinnacle/db-types";
import { cn } from "@/lib/utils";

type ModerationState = Database["public"]["Enums"]["job_moderation_state"];

export const moderationLabels = { visible: "Visible", hidden: "Hidden", org_suspended: "Hidden with the suspension" } as const satisfies Record<ModerationState, string>;

export function JobModerationBadge({ state }: { state: ModerationState }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border px-2 py-0.5 text-small font-medium",
        state === "visible" ? "bg-accent text-accent-foreground" : "border-destructive/30 bg-destructive-surface text-foreground",
      )}
    >
      {moderationLabels[state]}
    </span>
  );
}
