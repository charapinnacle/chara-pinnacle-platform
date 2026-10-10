import { createHmac, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { execute, literal, query } from "./db";
import { expect } from "./test";
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

export type BillingEvent = { kind: string } & Record<string, unknown>;

// A delivery to the billing-webhook process that supabase/functions/serve-local.sh starts (the null provider): the
// body names the event and holds it in the normalised form, signed with the secret that playwright.config.ts defines.
// A test passes another secret to send a forgery.
export async function deliverBillingEvent(
  event: BillingEvent,
  { id = `evt_${randomUUID()}`, createdAt = new Date().toISOString(), secret = process.env.BILLING_WEBHOOK_SECRET ?? "" } = {},
): Promise<Response> {
  const body = JSON.stringify({ id, event: { providerCreatedAt: createdAt, ...event } });
  return fetch(`http://127.0.0.1:${process.env.BILLING_WEBHOOK_PORT}/`, {
    method: "POST",
    headers: { "x-chara-signature": createHmac("sha256", secret).update(body).digest("hex") },
    body,
  });
}

export interface StoredEvent {
  provider_event_id: string;
  kind: string;
  status: string;
  error: string | null;
}

export function storedEvents(team: Pick<Team, "id">): StoredEvent[] {
  return query<StoredEvent>(
    `select provider_event_id, kind, status, error from billing.provider_events
     where payload ->> 'orgId' = ${literal(team.id)} order by received_at, id`,
  );
}

export function subscriptionRows(team: Pick<Team, "id">) {
  return query<{ plan_code: string; status: string; provider_customer_ref: string | null; provider_subscription_ref: string | null; past_due_since: string | null }>(
    `select plan_code, status, provider_customer_ref, provider_subscription_ref, past_due_since from billing.subscriptions
     where organization_id = ${literal(team.id)} order by created_at`,
  );
}

// As billing_checkout_start leaves the tax data of an organisation before the hosted page: a customer without a reference.
export function seedCustomer(team: Pick<Team, "id">, registrationNumber: string): void {
  execute(
    `insert into billing.customers (organization_id, provider, billing_country, registration_number)
     values (${literal(team.id)}, 'null', 'DE', ${literal(registrationNumber)})`,
  );
}

export function rejectedDeliveries(): number {
  const [row] = query<{ n: number }>(`select count(*)::int as n from audit.log where action = 'billing.webhook_rejected'`);
  return row.n;
}

export function repeatedTrialAlerts(team: Pick<Team, "id">): number {
  const [row] = query<{ n: number }>(
    `select count(*)::int as n from private.security_events
     where kind = 'billing_trial_repeated' and detail ->> 'organization_id' = ${literal(team.id)}`,
  );
  return row.n;
}

export function queuedMails(userId: string, kind: string): number {
  const [row] = query<{ n: number }>(
    `select count(*)::int as n from public.notifications where user_id = ${literal(userId)} and kind = ${literal(kind)}`,
  );
  return row.n;
}

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

// What the provider sends after a checkout with a trial: the customer is linked and the subscription starts Trialing.
// Returns the end of the trial as the database holds it.
export async function startTrialThroughWebhook(team: Pick<Team, "id">, customerRef = `cus_${randomUUID().slice(0, 8)}`): Promise<string> {
  const subscription = `sub_${randomUUID().slice(0, 8)}`;
  await deliverBillingEvent({ kind: "checkout.completed", orgId: team.id, providerCustomerRef: customerRef, providerSubscriptionRef: subscription });
  await deliverBillingEvent({
    kind: "subscription.activated",
    orgId: team.id,
    providerCustomerRef: customerRef,
    planCode: "employer_starter",
    status: "trialing",
    providerSubscriptionRef: subscription,
    trialEndsAt: days(30),
    currentPeriodEnd: days(30),
  });
  const [row] = query<{ trial_ends_at: string }>(`select trial_ends_at from billing.subscriptions where organization_id = ${literal(team.id)}`);
  return row.trial_ends_at;
}

export function setTrialDays(days: number): void {
  execute(`update billing.plans set trial_days = ${days} where code = 'employer_starter'`);
}

export function grantTrial(team: Pick<Team, "id">, key: string): void {
  execute(`insert into billing.trial_grants (identifier_key, organization_id) values (${literal(key)}, ${literal(team.id)})`);
}

const planSummary = (page: Page): Locator => page.getByRole("region", { name: "Current plan" });

// The value of a row of the plan summary of the billing page (Plan, Status).
export const summaryValue = (page: Page, label: string): Locator => planSummary(page).locator(`div:has(> dt:text-is("${label}")) > dd`);

export async function expectPlan(page: Page, plan: string, status: string): Promise<void> {
  await expect(summaryValue(page, "Plan")).toHaveText(plan);
  await expect(summaryValue(page, "Status")).toHaveText(status);
}

// Replaces the subscription rows of an organisation, so that one test can show it in several states in turn.
export function resetSubscriptions(team: Pick<Team, "id">): void {
  execute(`delete from billing.subscriptions where organization_id = ${literal(team.id)}`);
}

export function portalOpenedCount(team: Pick<Team, "id">): number {
  const [row] = query<{ n: number }>(
    `select count(*)::int as n from audit.log where action = 'billing.portal_opened' and entity_id = ${literal(team.id)}`,
  );
  return row.n;
}

export const NO_PAYMENT = "You have no active subscription, and no payment was taken.";

export async function fillCheckout(page: Page, { country = "DE", vat = "DE123456789", registration = "HRB 12345" } = {}) {
  await page.getByLabel("Billing country", { exact: true }).selectOption(country);
  await page.getByLabel("VAT ID", { exact: true }).fill(vat);
  await page.getByLabel("Company registration number", { exact: true }).fill(registration);
}

// Identifiers no other test uses: the first trial of a legal entity is recorded for good (billing.trial_grants), so a test
// that starts one through the webhook must not share its identifiers with the checkout tests, which expect a trial.
export function uniqueIdentifiers(): { vat: string; registration: string; registrationStored: string } {
  const digits = randomUUID().replace(/\D/g, "").padEnd(12, "7");
  return { vat: `DE${digits.slice(0, 9)}`, registration: `HRB ${digits.slice(9, 12)}${digits.slice(0, 3)}`, registrationStored: `HRB${digits.slice(9, 12)}${digits.slice(0, 3)}` };
}

export const terms = (page: Page): Locator => page.getByRole("checkbox", { name: /Subscription and Billing Terms/ });
export const proceed = (page: Page): Locator => page.getByRole("button", { name: /Continue to payment/ });
