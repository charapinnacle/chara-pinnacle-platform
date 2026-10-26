import type { ReleaseSwitch } from "@/lib/dal/release";
import type { PlatformRole } from "@/lib/validation/admin";

// An entry of a Phase 2 release is shown only while its release switch is on, as its pages answer not found otherwise.
type Entry = { label: string; segment: string; roles: readonly PlatformRole[]; release?: ReleaseSwitch };

const both = ["admin", "trust_safety"] as const;

// The functions of the console and the roles that have them. The page guards use the same table, so a role never sees a
// link to a page that answers it with not found. The plan editor and the settings (FR-R2) and the retention periods
// (FR-S3) belong to the administrator and are not behind a release switch: switching a release on is done there, and the
// periods govern Phase 1 data too.
export const adminEntries = [
  { label: "Users", segment: "users", roles: both },
  { label: "Organisations", segment: "organizations", roles: both },
  { label: "Statistics", segment: "statistics", roles: ["admin"] },
  { label: "Plans and limits", segment: "plans", roles: ["admin"] },
  { label: "Platform settings", segment: "settings", roles: ["admin"] },
  { label: "Retention periods", segment: "retention", roles: ["admin"] },
  { label: "Legal documents", segment: "legal", roles: ["admin"] },
  { label: "Audit log", segment: "audit", roles: ["admin"] },
  { label: "Staff", segment: "staff", roles: ["admin"] },
  { label: "MFA reset", segment: "mfa-reset", roles: ["admin"] },
  { label: "Reports", segment: "reports", roles: both },
  { label: "Vacancy moderation", segment: "moderation", roles: ["trust_safety"] },
  { label: "Suspensions and reinstatements", segment: "suspensions", roles: ["trust_safety"] },
  {
    label: "Partner reviews",
    segment: "partners",
    roles: ["trust_safety", "verification_reviewer", "admin"],
    release: "release_partner_directories",
  },
  { label: "Appeals", segment: "appeals", roles: both, release: "release_partner_directories" },
] as const satisfies readonly Entry[];

export function entriesFor(roles: readonly PlatformRole[], released: readonly ReleaseSwitch[] = []) {
  return adminEntries.filter(
    (entry: Entry) => entry.roles.some((role) => roles.includes(role)) && (!entry.release || released.includes(entry.release)),
  );
}
