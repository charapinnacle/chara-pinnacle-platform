import type { Page } from "@playwright/test";
import { literal, query } from "./db";

export interface CompanyDetails {
  legalName: string;
  displayName?: string;
  country: string;
  industry: string;
  website?: string;
  identifierKind?: string;
  identifier?: string;
}

export async function fillCompany(page: Page, details: CompanyDetails): Promise<void> {
  await page.getByLabel("Legal company name").fill(details.legalName);
  if (details.displayName) await page.getByLabel("Display name (optional)").fill(details.displayName);
  await page.getByLabel("Country", { exact: true }).selectOption({ label: details.country });
  await page.getByLabel("Industry", { exact: true }).selectOption({ label: details.industry });
  if (details.website) await page.getByLabel("Website (optional)").fill(details.website);
  if (details.identifierKind) {
    await page
      .getByLabel("Type of legal-entity identifier (optional)")
      .selectOption({ value: details.identifierKind });
  }
  if (details.identifier) {
    await page.getByLabel("Legal-entity identifier (optional)", { exact: true }).fill(details.identifier);
  }
}

export function organizationRows(userId: string) {
  return query<{
    id: string;
    type: string;
    slug: string;
    status: string;
    legal_name: string;
    display_name: string;
    based_in_country: string;
    industry_code: string | null;
    website: string | null;
    legal_entity_identifier: string | null;
    legal_entity_identifier_kind: string | null;
    role: string;
    accepted_at: string | null;
    invited_by: string | null;
  }>(
    `select o.id, o.type, o.slug, o.status, o.legal_name, o.display_name, o.based_in_country, o.industry_code,
            o.website, o.legal_entity_identifier, o.legal_entity_identifier_kind, m.role, m.accepted_at, m.invited_by
     from public.organization_members m join public.organizations o on o.id = m.organization_id
     where m.user_id = ${literal(userId)} order by o.created_at`,
  );
}

export function organizationAudit(organizationId: string) {
  return query<{ actor_id: string | null; action: string; entity_type: string; metadata: Record<string, unknown> }>(
    `select actor_id, action, entity_type, metadata from audit.log
     where entity_id = ${literal(organizationId)} order by id`,
  );
}

export function organizationCountByName(legalName: string): number {
  return query<{ id: string }>(
    `select id from public.organizations where legal_name = ${literal(legalName)}`,
  ).length;
}
