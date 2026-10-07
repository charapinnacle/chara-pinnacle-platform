import type { Locator, Page } from "@playwright/test";
import { execute, literal, query } from "./db";
import type { Company } from "./jobs";
import { expect } from "./test";

export const applicantsUrl = (slug: string, search = "") => `/en/org/${slug}/applicants${search}`;

export function subscribe(company: Company, plan: string, status = "active"): void {
  execute(
    `insert into billing.subscriptions (organization_id, plan_code, status, provider)
     values (${literal(company.id)}, ${literal(plan)}, ${literal(status)}, 'null')`,
  );
}

export interface ListApplicant {
  name: string;
  status?: string;
  appliedAt: string;
  completeness: number;
  documents?: number;
  revoked?: boolean;
  worker?: string;
}

// An application as apply_to_job would have written it for a candidate with the given name, completeness and shared
// documents, written by the database owner so that a test can give it any stage and date. worker is a user id; without
// one the candidate is a new id that belongs to no account.
export function seedListApplicant(company: Company, jobId: string, a: ListApplicant): string {
  const { name, status = "applied", appliedAt, completeness, documents = 0, revoked = false } = a;
  const [first, ...rest] = name.split(" ");
  const worker = a.worker ? literal(a.worker) : "gen_random_uuid()";
  return execute(
    `with ids as (select gen_random_uuid() as application_id, gen_random_uuid() as share_id, ${worker}::uuid as worker_id),
     consent as (
       insert into public.consents (user_id, purpose, version, action)
       select ids.worker_id, 'share_passport:' || ${literal(company.id)} || ':' || ids.application_id, max(d.version), 'granted'
       from public.legal_documents d, ids where d.slug = 'sharing-notice' group by ids.worker_id, ids.application_id
       returning id
     ),
     application as (
       insert into public.job_applications (id, job_id, organization_id, worker_user_id, status, passport_share_id, profile_snapshot, created_at)
       select application_id, ${literal(jobId)}, ${literal(company.id)}, worker_id, ${literal(status)}, share_id,
              jsonb_build_object('first_name', ${literal(first)}, 'last_name', ${literal(rest.join(" "))}, 'completeness', ${completeness}),
              ${literal(appliedAt)}::timestamptz
       from ids returning id
     ), share as (
       insert into public.passport_shares (id, worker_user_id, organization_id, application_id, scope, consent_id, revoked_at)
       select ids.share_id, ids.worker_id, ${literal(company.id)}, application.id,
              (select coalesce(jsonb_agg(gen_random_uuid()), '[]') from generate_series(1, ${documents})), consent.id,
              ${revoked ? "now()" : "null"}
       from ids, application, consent returning application_id
     )
     insert into public.application_events (application_id, from_status, to_status, actor_id, created_at)
     select share.application_id, null, 'applied', (select worker_id from ids), ${literal(appliedAt)}::timestamptz from share returning application_id`,
  ).trim();
}

// count applications "Cand 1" to "Cand <count>": the higher the number, the newer the application, the completeness is
// n * 7 modulo 101 and the documents n modulo 4. stageOf is an SQL expression of ids.n that gives the stage.
export function seedMany(company: Company, jobId: string, count: number, stageOf = "'applied'"): void {
  execute(
    `with n as (select generate_series as n from generate_series(1, ${count})),
     ids as (select n, gen_random_uuid() as application_id, gen_random_uuid() as share_id, gen_random_uuid() as worker_id from n),
     consent as (
       insert into public.consents (user_id, purpose, version, action)
       select ids.worker_id, 'share_passport:' || ${literal(company.id)} || ':' || ids.application_id, max(d.version), 'granted'
       from public.legal_documents d, ids where d.slug = 'sharing-notice' group by ids.worker_id, ids.application_id
       returning id, user_id
     ),
     application as (
       insert into public.job_applications (id, job_id, organization_id, worker_user_id, status, passport_share_id, profile_snapshot, created_at)
       select application_id, ${literal(jobId)}, ${literal(company.id)}, worker_id, (${stageOf})::public.application_status, share_id,
              jsonb_build_object('first_name', 'Cand', 'last_name', ids.n::text, 'completeness', (ids.n * 7) % 101),
              '2026-09-01T10:00:00Z'::timestamptz + make_interval(mins => ids.n)
       from ids returning id, passport_share_id
     ), share as (
       insert into public.passport_shares (id, worker_user_id, organization_id, application_id, scope, consent_id)
       select ids.share_id, ids.worker_id, ${literal(company.id)}, ids.application_id,
              (select coalesce(jsonb_agg(gen_random_uuid()), '[]') from generate_series(1, ids.n % 4)), consent.id
       from ids join consent on consent.user_id = ids.worker_id join application on application.id = ids.application_id
       returning application_id
     )
     insert into public.application_events (application_id, from_status, to_status, actor_id, created_at)
     select ids.application_id, null, 'applied', ids.worker_id, now() from ids join share on share.application_id = ids.application_id`,
  );
}

export function renameCandidate(applicationId: string, name: string): void {
  const [first, ...rest] = name.split(" ");
  execute(
    `update public.job_applications set profile_snapshot = profile_snapshot || jsonb_build_object('first_name', ${literal(first)}, 'last_name', ${literal(rest.join(" "))})
     where id = ${literal(applicationId)}`,
  );
}

export function statusOf(applicationId: string): string {
  return execute(`select status::text from public.job_applications where id = ${literal(applicationId)}`).trim();
}

export function eventCount(applicationId: string): number {
  return query<{ n: number }>(`select count(*)::int as n from public.application_events where application_id = ${literal(applicationId)}`)[0].n;
}

export const listRows = (page: Page): Locator => page.getByRole("table").locator("tbody tr");

// The text of each cell of each row, in the order of the table. The abbreviation of September depends on the ICU version.
export async function cellTexts(page: Page): Promise<string[][]> {
  return listRows(page).evaluateAll((rows) =>
    rows.map((row) => Array.from(row.querySelectorAll("td")).map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").replace("Sept", "Sep").trim())),
  );
}

export const boardColumn = (page: Page, stage: string): Locator =>
  page.getByRole("group").filter({ has: page.getByRole("heading", { name: stage }) });

// Drags a card to a column with the mouse. The board scrolls inside its own container, so the target column is brought into
// view while the card is held, as a person would do by holding it at the edge.
export async function dragCard(page: Page, name: string, stage: string): Promise<void> {
  const card = page.getByRole("listitem").filter({ hasText: name });
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  if (!from) throw new Error(`The card of ${name} is not on the page`);
  await page.mouse.move(from.x + from.width / 2, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + 20);
  const target = boardColumn(page, stage);
  await target.evaluate((element) => element.scrollIntoView({ inline: "center", block: "nearest" }));
  const to = await target.boundingBox();
  if (!to) throw new Error(`The column ${stage} is not on the page`);
  await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 6 });
  await page.mouse.up();
}

export async function columnCounts(page: Page): Promise<Record<string, string>> {
  const headings = page.getByRole("region", { name: "Pipeline board" }).getByRole("heading", { level: 2 });
  await expect(headings).toHaveCount(8);
  const texts = await headings.allTextContents();
  return Object.fromEntries(texts.map((text) => [text.replace(/\d+$/, ""), text.match(/\d+$/)?.[0] ?? ""]));
}

export async function expectNoDocumentNames(page: Page): Promise<void> {
  await expect(page.getByText(/\.pdf|\.docx?|passport-documents/i)).toHaveCount(0);
}
