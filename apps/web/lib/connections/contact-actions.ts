import type { Database } from "@chara-pinnacle/db-types";

type OrganizationType = Database["public"]["Enums"]["organization_type"];

// Whom an employer may ask for workers (FR-P2 AC3): a staffing company, or a recruitment company listing the staffing
// service (FR-K2). request_workforce checks it again.
export function offersStaffing(type: OrganizationType, serviceTypes: readonly string[] | null): boolean {
  return type === "staffing_company" || (type === "recruitment_company" && (serviceTypes ?? []).includes("staffing"));
}
