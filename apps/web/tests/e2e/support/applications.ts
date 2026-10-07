import { expect, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { execute, literal, query } from "./db";
import { createCommittedUser } from "./login";
import { overflow } from "./login-page";
import type { Company } from "./jobs";
import type { TestUser } from "./test-user";

export interface ApplicationRow {
  id: string;
  job_id: string;
  organization_id: string;
  status: string;
  cover_note: string | null;
  passport_share_id: string;
  profile_snapshot: Record<string, unknown>;
  created_at: string;
}

export function applicationRows(userId: string): ApplicationRow[] {
  return query<ApplicationRow>(
    `select id, job_id, organization_id, status::text, cover_note, passport_share_id, profile_snapshot, created_at::text
     from public.job_applications where worker_user_id = ${literal(userId)} order by created_at, id`,
  );
}

export function applicationsOf(jobId: string): ApplicationRow[] {
  return query<ApplicationRow>(
    `select id, job_id, organization_id, status::text, cover_note, passport_share_id, profile_snapshot, created_at::text
     from public.job_applications where job_id = ${literal(jobId)} order by created_at, id`,
  );
}

export function eventRows(applicationId: string) {
  return query<{ from_status: string | null; to_status: string; actor_id: string | null; note: string | null; created_at: string }>(
    `select from_status::text, to_status::text, actor_id, note, created_at::text
     from public.application_events where application_id = ${literal(applicationId)} order by id`,
  );
}

export function shareOf(applicationId: string) {
  return query<{ organization_id: string; scope: string[]; consent_id: number; expires_at: string | null; revoked_at: string | null }>(
    `select organization_id, scope, consent_id, expires_at::text, revoked_at::text
     from public.passport_shares where application_id = ${literal(applicationId)}`,
  );
}

export function consentOf(consentId: number) {
  return query<{ user_id: string; purpose: string; version: number; action: string }>(
    `select user_id, purpose, version, action::text from public.consents where id = ${consentId}`,
  );
}

export function queuedForApplication(applicationId: string) {
  return query<{ kind: string; user_id: string }>(
    `select message ->> 'kind' as kind, message ->> 'user_id' as user_id from pgmq.q_notifications
     where message ->> 'application_id' = ${literal(applicationId)} order by message ->> 'user_id'`,
  );
}

export function auditCount(action: string, entityId: string): number {
  const [row] = query<{ n: number }>(
    `select count(*)::int as n from audit.log where action = ${literal(action)} and entity_id = ${literal(entityId)}`,
  );
  return row.n;
}

// An application as apply_to_job would have written it, written by the database owner so that a test can give it any
// stage and date. The share and the consent (which names the application) are the ones apply_to_job makes.
export function seedApplication(
  workerId: string,
  jobId: string,
  organizationId: string,
  options: { status?: string; createdAt?: string; coverNote?: string | null; documentIds?: string[] } = {},
): string {
  const { status = "applied", createdAt = "now()", coverNote = null, documentIds = [] } = options;
  return execute(
    `with ids as (select gen_random_uuid() as application_id, gen_random_uuid() as share_id),
     consent as (
       insert into public.consents (user_id, purpose, version, action)
       select ${literal(workerId)}, 'share_passport:' || ${literal(organizationId)} || ':' || ids.application_id, max(d.version), 'granted'
       from public.legal_documents d, ids where d.slug = 'sharing-notice' group by ids.application_id
       returning id
     ),
     application as (
       insert into public.job_applications (id, job_id, organization_id, worker_user_id, status, cover_note, passport_share_id, profile_snapshot, created_at)
       select application_id, ${literal(jobId)}, ${literal(organizationId)}, ${literal(workerId)}, ${literal(status)}, ${coverNote === null ? "null" : literal(coverNote)}, share_id, '{}', ${createdAt}
       from ids returning id
     ), share as (
       insert into public.passport_shares (id, worker_user_id, organization_id, application_id, scope, consent_id)
       select ids.share_id, ${literal(workerId)}, ${literal(organizationId)}, application.id, ${literal(JSON.stringify(documentIds))}::jsonb, consent.id from ids, application, consent
       returning application_id
     )
     insert into public.application_events (application_id, from_status, to_status, actor_id, created_at)
     select share.application_id, null, 'applied', ${literal(workerId)}, ${createdAt} from share returning application_id`,
  ).trim();
}

// An event of an application as an employer member or the system would have written it, with its own time.
export function seedEvent(
  applicationId: string,
  { from, to, actorId = null, note = null, at }: { from: string | null; to: string; actorId?: string | null; note?: string | null; at: string },
): void {
  execute(
    `insert into public.application_events (application_id, from_status, to_status, actor_id, note, created_at)
     values (${literal(applicationId)}, ${from === null ? "null" : literal(from)}, ${literal(to)}, ${actorId === null ? "null" : literal(actorId)},
             ${note === null ? "null" : literal(note)}, ${literal(at)})`,
  );
}

// count vacancies "Listed welder 1" to "Listed welder <count>" of the organisation, each with an application of the
// candidate in Applied whose only event is n minutes old: the lower the number, the newer the latest event.
export function seedManyApplications(workerId: string, company: Company, count: number): void {
  execute(
    `with vacancies as (
       insert into public.jobs (organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type,
                                recruitment_preference, status, created_by)
       select ${literal(company.id)}, 'Listed welder ' || n, 'Line one of the description.' || chr(10) || 'Line two of it, which is long enough to pass the limit.',
              '7212', 'C', 'DE', 'Hamburg', 'full_time', 'both', 'open', ${literal(company.owner.id)}
       from generate_series(1, ${count}) n returning id, substring(title from '[0-9]+$')::int as n
     ), applications as (
       insert into public.job_applications (id, job_id, organization_id, worker_user_id, status, passport_share_id, profile_snapshot, created_at)
       select gen_random_uuid(), v.id, ${literal(company.id)}, ${literal(workerId)}, 'applied', gen_random_uuid(), '{}', now() - interval '100 days'
       from vacancies v returning id, passport_share_id, job_id
     ), consents as (
       insert into public.consents (user_id, purpose, version, action)
       select ${literal(workerId)}, 'share_passport:' || ${literal(company.id)} || ':' || a.id, max(d.version), 'granted'
       from applications a, public.legal_documents d where d.slug = 'sharing-notice' group by a.id returning id, purpose
     ), shares as (
       insert into public.passport_shares (id, worker_user_id, organization_id, application_id, scope, consent_id)
       select a.passport_share_id, ${literal(workerId)}, ${literal(company.id)}, a.id, '[]', c.id
       from applications a join consents c on c.purpose = 'share_passport:' || ${literal(company.id)} || ':' || a.id returning application_id
     )
     insert into public.application_events (application_id, from_status, to_status, actor_id, created_at)
     select a.id, null, 'applied', ${literal(workerId)}, now() - make_interval(mins => v.n)
     from applications a join vacancies v on v.id = a.job_id`,
  );
}

// NFR-U1 and NFR-U2: the state on screen has no serious WCAG 2.2 A/AA violation and no horizontal scroll at 1280 and 360 px.
export async function expectAccessibleAtBothWidths(page: Page): Promise<void> {
  for (const [width, height] of [[1280, 900], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    expect(await overflow(page), `Horizontal overflow at ${width}px on ${page.url()}`).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
  }
}

export const applyUrl = (jobId: string) => `/en/jobs/${jobId}/apply`;
export const applicationUrl = (id: string) => `/en/applications/${id}`;
export const APPLICATIONS_URL = "/en/applications";
export const NOT_ACCEPTING = "This vacancy is no longer accepting applications";

// A candidate whose passport has what an application needs: the names and the country of the account setup, and an occupation.
export async function newApplicant({ occupation = true } = {}): Promise<TestUser> {
  const user = await createCommittedUser("worker");
  if (occupation) execute(`update public.worker_profiles set occupation_id = '7212' where user_id = ${literal(user.id)}`);
  return user;
}

// Takes every open vacancy of the organisation out of the open state, as the lapse of a subscription does.
export function pauseVacancies(organizationId: string): void {
  execute(`select private.pause_jobs_on_lapse(${literal(organizationId)})`);
}

export function displayName(organizationId: string): string {
  return execute(`select display_name from public.organizations where id = ${literal(organizationId)}`).trim();
}
