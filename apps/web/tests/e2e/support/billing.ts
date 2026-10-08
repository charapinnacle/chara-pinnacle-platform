import type { Page } from "@playwright/test";
import { execute, literal, query } from "./db";
import type { Team } from "./team";
import type { TestUser } from "./test-user";

export const HOSTED_ORIGIN = "https://null-provider.invalid";

export function billingPath(slug: string): string {
  return `/en/org/${slug}/billing`;
}

export function checkoutPath(slug: string, plan = "employer_starter"): string {
  return `${billingPath(slug)}/checkout?plan=${plan}`;
}

// The hosted pages of the null provider do not exist: the browser is sent to an address that cannot resolve, and the
// test answers it with a page that has the links the provider would have (complete, cancel, return). The addresses
// visited are kept in `visits`.
export async function stubHostedPages(page: Page): Promise<{ visits: URL[] }> {
  const visits: URL[] = [];
  await page.route(`${HOSTED_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    visits.push(url);
    const links = [...url.searchParams].map(([name, target]) => `<a href="${target}">${name}</a>`).join(" ");
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Hosted page</title><main>${links}</main>` });
  });
  return { visits };
}

export function setIdentifier(team: Pick<Team, "id">, identifier: string, kind = "registration_number"): void {
  execute(
    `update public.organizations set legal_entity_identifier = ${literal(identifier)}, legal_entity_identifier_kind = ${literal(kind)}
     where id = ${literal(team.id)}`,
  );
}

export function customerRows(team: Pick<Team, "id">) {
  return query<{
    provider: string;
    customer_ref: string | null;
    billing_country: string;
    vat_id: string | null;
    registration_number: string | null;
  }>(
    `select provider, customer_ref, billing_country, vat_id, registration_number from billing.customers
     where organization_id = ${literal(team.id)}`,
  );
}

export function subscriptionCount(team: Pick<Team, "id">): number {
  const [row] = query<{ n: number }>(`select count(*)::int as n from billing.subscriptions where organization_id = ${literal(team.id)}`);
  return row.n;
}

export function trialGrantCount(team: Pick<Team, "id">): number {
  const [row] = query<{ n: number }>(`select count(*)::int as n from billing.trial_grants where organization_id = ${literal(team.id)}`);
  return row.n;
}

export function termsConsents(user: TestUser) {
  return query<{ version: number; action: string }>(
    `select version, action::text from public.consents
     where user_id = ${literal(user.id)} and purpose = 'subscription-and-billing-terms' order by id`,
  );
}

export function currentTermsVersion(): number {
  const [row] = query<{ version: number }>(`select private.current_legal_version('subscription-and-billing-terms') as version`);
  return row.version;
}

// As the billing webhook leaves an organization after a checkout: the customer linked, and a subscription in a state.
export function linkCustomer(team: Pick<Team, "id">, customerRef: string): void {
  execute(
    `insert into billing.customers (organization_id, provider, customer_ref, billing_country, vat_id)
     values (${literal(team.id)}, 'null', ${literal(customerRef)}, 'DE', 'DE123456789')
     on conflict (organization_id) do update set customer_ref = excluded.customer_ref`,
  );
}

export function startTrial(team: Pick<Team, "id">, trialDays = 30): string {
  execute(
    `insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at, current_period_end)
     values (${literal(team.id)}, 'employer_starter', 'trialing', 'null', now() + make_interval(days => ${trialDays}), now() + make_interval(days => ${trialDays}))`,
  );
  const [row] = query<{ trial_ends_at: string }>(
    `select trial_ends_at from billing.subscriptions where organization_id = ${literal(team.id)}`,
  );
  return row.trial_ends_at;
}

export function setTrialDays(days: number): void {
  execute(`update billing.plans set trial_days = ${days} where code = 'employer_starter'`);
}

export function grantTrial(team: Pick<Team, "id">, key: string): void {
  execute(`insert into billing.trial_grants (identifier_key, organization_id) values (${literal(key)}, ${literal(team.id)})`);
}
