import type { LegalAcceptance } from "@/lib/dal/admin";
import { partnerLegalSlugs } from "@/lib/public/navigation";

// The audiences of public.admin_legal_acceptance: a sign-up list (account kind, or partner type for a partner company
// user), or 'org:<type>' for the organisations of a partner type whose owner's consent counts.
const audienceLabels: Record<string, string> = {
  worker: "Workers",
  company: "Employers",
  recruitment_company: "Recruitment companies",
  staffing_company: "Staffing companies",
  "org:recruitment_company": "Recruitment company organisations",
  "org:staffing_company": "Staffing company organisations",
};

export function acceptanceLine({ audience, accepted, total }: LegalAcceptance): string {
  return `${audienceLabels[audience] ?? audience}: ${accepted} of ${total}`;
}

export const legalDocumentGroups = { all: "All documents", partner: "Partner network" } as const;

export type LegalDocumentGroup = keyof typeof legalDocumentGroups;

export function legalDocumentGroup(value: unknown): LegalDocumentGroup {
  return value === "partner" ? "partner" : "all";
}

export function inLegalDocumentGroup(slug: string, group: LegalDocumentGroup): boolean {
  return group === "all" || partnerLegalSlugs.includes(slug);
}
