import { execute, literal, query } from "./db";
import { createCommittedUser } from "./login";
import { organizationRows, registerOrganization, uniqueName } from "./organizations";
import type { TestUser } from "./test-user";

export interface Employer {
  owner: TestUser;
  member: TestUser;
  organizationId: string;
}

// An organization with its owner and one plain member, both able to sign in.
export async function createEmployer(displayName = "Acme Bau"): Promise<Employer> {
  const owner = await createCommittedUser("company");
  await registerOrganization(owner, uniqueName("Acme Bau GmbH"), displayName);
  const member = await createCommittedUser("company");
  const { id: organizationId } = organizationRows(owner.id)[0];
  execute(
    `insert into public.organization_members (organization_id, user_id, role, accepted_at)
     values (${literal(organizationId)}, ${literal(member.id)}, 'member', now())`,
  );
  return { owner, member, organizationId };
}

// What apply_to_job writes for an application: a granted consent, a vacancy of the organisation with an application of
// the candidate, and a share of the selected documents.
export function seedShare(workerId: string, organizationId: string, documentIds: string[]): string {
  return execute(
    `with consent as (
       insert into public.consents (user_id, purpose, version, action)
       select ${literal(workerId)}, d.slug, d.version, 'granted' from public.legal_documents d
       where d.slug = 'privacy-policy' order by d.version desc limit 1
       returning id
     ), vacancy as (
       insert into public.jobs (organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type, recruitment_preference)
       values (${literal(organizationId)}, 'Seeded vacancy', 'A seeded vacancy with a description that is long enough to pass the check.',
               '7212', 'C', 'DE', 'Hamburg', 'full_time', 'both')
       returning id
     ), application as (
       insert into public.job_applications (job_id, organization_id, worker_user_id, passport_share_id, profile_snapshot)
       select vacancy.id, ${literal(organizationId)}, ${literal(workerId)}, gen_random_uuid(), '{}' from vacancy
       returning id
     )
     insert into public.passport_shares (worker_user_id, organization_id, application_id, scope, consent_id)
     select ${literal(workerId)}, ${literal(organizationId)}, application.id, ${literal(JSON.stringify(documentIds))}::jsonb, consent.id
     from consent, application returning id`,
  ).trim();
}

export function shareRows(workerId: string) {
  return query<{ id: string; organization_id: string; scope: string[]; revoked_at: string | null }>(
    `select id, organization_id, scope, revoked_at::text from public.passport_shares
     where worker_user_id = ${literal(workerId)} order by created_at, id`,
  );
}

export function shareAudit(shareId: string): string[] {
  return query<{ action: string }>(
    `select action from audit.log where entity_type = 'passport_shares' and entity_id = ${literal(shareId)} order by id`,
  ).map((row) => row.action);
}

export function accessLog(documentId: string) {
  return query<{ share_id: string | null; organization_id: string | null; accessed_by: string; purpose: string }>(
    `select share_id, organization_id, accessed_by, purpose from audit.document_access_log
     where document_id = ${literal(documentId)} order by id`,
  );
}

// The document-url function as the Server Action of the applicant page will call it (serve-local.sh starts the process;
// playwright.config.ts defines the port): a bearer token and the document id, nothing else.
export async function requestDocumentUrl(
  bearer: string | null,
  documentId: string,
  purpose = "application_review",
): Promise<{ status: number; body: { url?: string; error?: string } }> {
  const response = await fetch(`http://127.0.0.1:${process.env.DOCUMENT_URL_PORT}/`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ documentId, purpose }),
  });
  return { status: response.status, body: (await response.json()) as { url?: string; error?: string } };
}

// What document_access_grant wrote for openings that happened some minutes ago, so that a page has entries to list.
export function seedOpenings(
  workerId: string,
  employer: Employer,
  shareId: string,
  documentId: string,
  minutesAgo: number[],
): void {
  execute(
    `insert into audit.document_access_log (share_id, document_id, worker_user_id, organization_id, accessed_by, purpose, accessed_at)
     select ${literal(shareId)}, ${literal(documentId)}, ${literal(workerId)}, ${literal(employer.organizationId)},
            ${literal(employer.member.id)}, 'application_review', now() - make_interval(mins => m)
     from unnest(array[${minutesAgo.join(",")}]) as m`,
  );
}
