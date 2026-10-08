import type { PlatformRole } from "@/lib/validation/admin";

type Entry = { label: string; segment: string; roles: readonly PlatformRole[] };

const both = ["admin", "trust_safety"] as const;

// The functions of the console and the roles that have them. The page guards use the same table, so a role never sees a
// link to a page that answers it with not found. No role has a screen for plans, limits or settings in Phase 1.
export const adminEntries = [
  { label: "Users", segment: "users", roles: both },
  { label: "Organisations", segment: "organizations", roles: both },
  { label: "Statistics", segment: "statistics", roles: ["admin"] },
  { label: "Legal documents", segment: "legal", roles: ["admin"] },
  { label: "Audit log", segment: "audit", roles: ["admin"] },
  { label: "Staff", segment: "staff", roles: ["admin"] },
  { label: "MFA reset", segment: "mfa-reset", roles: ["admin"] },
  { label: "Suspensions and reinstatements", segment: "suspensions", roles: ["trust_safety"] },
] as const satisfies readonly Entry[];

export function entriesFor(roles: readonly PlatformRole[]) {
  return adminEntries.filter((entry) => entry.roles.some((role) => roles.includes(role)));
}
