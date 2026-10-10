import type { StatusTone } from "@/lib/status-tone";

export type AccountStatus = "active" | "suspended" | "deletion_pending";

export const accountStatusLabels = { active: "Active", suspended: "Suspended", deletion_pending: "Deletion pending" } as const satisfies Record<AccountStatus, string>;

export const accountStatusTones = { active: "success", suspended: "danger", deletion_pending: "warning" } as const satisfies Record<AccountStatus, StatusTone>;
