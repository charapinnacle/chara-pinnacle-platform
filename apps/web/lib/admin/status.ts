import type { Database } from "@chara-pinnacle/db-types";
import type { StatusTone } from "@/lib/status-tone";

export type AccountStatus = Database["public"]["Enums"]["profile_status"] | Database["public"]["Enums"]["organization_status"];

export const accountStatusLabels = { active: "Active", suspended: "Suspended", deletion_pending: "Deletion pending" } as const satisfies Record<AccountStatus, string>;

export const accountStatusTones = { active: "success", suspended: "danger", deletion_pending: "warning" } as const satisfies Record<AccountStatus, StatusTone>;
