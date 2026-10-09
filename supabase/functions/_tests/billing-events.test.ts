import assert from "node:assert/strict";
import type { NormalizedEvent } from "../_shared/billing/provider.ts";
import { nullProvider } from "../_shared/billing/providers/null.ts";
import { stripeProvider } from "../_shared/billing/providers/stripe.ts";
import { hmacHex } from "../_shared/billing/signature.ts";
import charge from "./fixtures/stripe/events/charge-succeeded.json" with { type: "json" };
import checkoutCompleted from "./fixtures/stripe/events/checkout-session-completed.json" with { type: "json" };
import customerUpdated from "./fixtures/stripe/events/customer-updated.json" with { type: "json" };
import invoiceOneOff from "./fixtures/stripe/events/invoice-without-subscription.json" with { type: "json" };
import invoicePaidTrial from "./fixtures/stripe/events/invoice-paid-trial.json" with { type: "json" };
import invoicePaid from "./fixtures/stripe/events/invoice-paid.json" with { type: "json" };
import invoiceFailed from "./fixtures/stripe/events/invoice-payment-failed.json" with { type: "json" };
import basil from "./fixtures/stripe/events/subscription-basil.json" with { type: "json" };
import created from "./fixtures/stripe/events/subscription-created.json" with { type: "json" };
import deleted from "./fixtures/stripe/events/subscription-deleted.json" with { type: "json" };
import incomplete from "./fixtures/stripe/events/subscription-incomplete.json" with { type: "json" };
import trialWillEnd from "./fixtures/stripe/events/subscription-trial-will-end.json" with { type: "json" };
import unknownPrice from "./fixtures/stripe/events/subscription-unknown-price.json" with { type: "json" };
import updated from "./fixtures/stripe/events/subscription-updated.json" with { type: "json" };

// The fixtures are shaped after Stripe's API reference, not recorded from a live account (none exists yet).
const SITE = "https://app.chara.example";
const ORG = "7b0f6a53-2d2c-4a43-9b3b-0f5a3f4a1e11";
const SECRET = "whsec_test_secret";
const NOW = Date.parse("2026-11-01T10:00:00Z");

const stripe = (now = NOW) =>
  stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE, webhookSecret: SECRET }, fetch, () => now);

async function stripeRequest(body: string, header?: string): Promise<Request> {
  const t = Math.floor(NOW / 1000);
  const signature = header ?? `t=${t},v1=${await hmacHex(SECRET, `${t}.${body}`)}`;
  return new Request("http://stack.test/functions/v1/billing-webhook", {
    method: "POST",
    headers: signature ? { "stripe-signature": signature } : {},
    body,
  });
}

const raw = (event: unknown) => JSON.stringify(event, null, 2);

Deno.test("FR-G3 AC11: checkout.session.completed is checkout.completed with the organisation of client_reference_id", () => {
  assert.deepEqual(stripe().normalize(checkoutCompleted), [{
    kind: "checkout.completed",
    providerCreatedAt: "2026-11-01T10:00:00.000Z",
    orgId: ORG,
    providerCustomerRef: "cus_1Nx",
    providerSubscriptionRef: "sub_1Nx",
  }]);
});

Deno.test("FR-G3 AC11: customer.subscription.created, .updated and .deleted keep the plan code of the price metadata, the dates and the organisation", () => {
  assert.deepEqual(stripe().normalize(created), [{
    kind: "subscription.activated",
    providerCreatedAt: "2026-11-01T10:00:00.000Z",
    orgId: ORG,
    providerCustomerRef: "cus_1Nx",
    planCode: "employer_starter",
    status: "trialing",
    providerSubscriptionRef: "sub_1Nx",
    currentPeriodStart: "2026-11-01T10:00:00.000Z",
    currentPeriodEnd: "2026-12-01T10:00:00.000Z",
    trialEndsAt: "2026-12-01T10:00:00.000Z",
  }]);
  assert.deepEqual(stripe().normalize(updated), [{
    kind: "subscription.updated",
    providerCreatedAt: "2026-11-02T09:00:00.000Z",
    orgId: ORG,
    providerCustomerRef: "cus_1Nx",
    planCode: "employer_professional",
    status: "active",
    providerSubscriptionRef: "sub_1Nx",
    currentPeriodStart: "2026-11-01T10:00:00.000Z",
    currentPeriodEnd: "2026-12-01T10:00:00.000Z",
    trialEndsAt: "2026-12-01T10:00:00.000Z",
    cancelAt: "2027-01-01T10:00:00.000Z",
  }]);
  const [cancellation] = stripe().normalize(deleted);
  assert.equal(cancellation.kind, "subscription.canceled");
  assert.equal(cancellation.providerCreatedAt, "2026-11-07T09:00:00.000Z");
  assert.equal((cancellation as { status: string }).status, "canceled");
});

Deno.test("FR-G3 AC11: customer.subscription.trial_will_end is subscription.trial_will_end with the end of the trial", () => {
  assert.deepEqual(stripe().normalize(trialWillEnd), [{
    kind: "subscription.trial_will_end",
    providerCreatedAt: "2026-11-28T10:00:00.000Z",
    orgId: ORG,
    providerCustomerRef: "cus_1Nx",
    providerSubscriptionRef: "sub_1Nx",
    trialEndsAt: "2026-12-01T10:00:00.000Z",
  }]);
});

Deno.test("FR-G3 AC11: invoice.paid is payment.succeeded with the amount, the tax, the invoice and the payment reference", () => {
  assert.deepEqual(stripe().normalize(invoicePaid), [{
    kind: "payment.succeeded",
    providerCreatedAt: "2026-12-01T10:00:05.000Z",
    purpose: "subscription",
    orgId: ORG,
    providerCustomerRef: "cus_1Nx",
    providerSubscriptionRef: "sub_1Nx",
    subscriptionStatus: "active",
    amountMinor: 3900,
    taxMinor: 741,
    currency: "EUR",
    invoiceRef: "in_1Nx",
    providerPaymentRef: "pi_1Nx",
  }]);
});

Deno.test("FR-G3 AC11: the zero-amount invoice of a trial leaves the subscription Trialing and falls back to the invoice as payment reference", () => {
  const [event] = stripe().normalize(invoicePaidTrial) as Extract<NormalizedEvent, { kind: "payment.succeeded" }>[];
  assert.equal(event.subscriptionStatus, "trialing");
  assert.equal(event.amountMinor, 0);
  assert.equal(event.providerPaymentRef, "in_0Nx");
});

Deno.test("FR-G3 AC11: invoice.payment_failed is payment.failed; the newer invoice shape (parent.subscription_details) is read as well", () => {
  assert.deepEqual(stripe().normalize(invoiceFailed), [{
    kind: "payment.failed",
    providerCreatedAt: "2026-12-01T10:05:00.000Z",
    orgId: ORG,
    providerCustomerRef: "cus_1Nx",
    providerSubscriptionRef: "sub_1Nx",
    providerPaymentRef: "pi_2Nx",
  }]);
});

Deno.test("the newer subscription shape: periods on the item, an expanded customer, unpaid as past due, cancel at period end", () => {
  assert.deepEqual(stripe().normalize(basil), [{
    kind: "subscription.updated",
    providerCreatedAt: "2026-11-01T10:00:00.000Z",
    orgId: ORG,
    providerCustomerRef: "cus_1Nx",
    planCode: "employer_starter",
    status: "past_due",
    providerSubscriptionRef: "sub_1Nx",
    currentPeriodStart: "2026-11-01T10:00:00.000Z",
    currentPeriodEnd: "2026-12-01T10:00:00.000Z",
    cancelAt: "2026-12-01T10:00:00.000Z",
  }]);
});

Deno.test("a price without a plan code gives an event without one, which the database refuses as an unknown plan", () => {
  const [event] = stripe().normalize(unknownPrice);
  assert.equal(event.kind, "subscription.updated");
  assert.equal("planCode" in event, false);
});

Deno.test("FR-G3 AC11: other types, an unfinished subscription and an invoice without a subscription give no event", () => {
  const provider = stripe();
  for (const other of [charge, customerUpdated, incomplete, invoiceOneOff, null, "text", { type: "invoice.paid" }]) {
    assert.deepEqual(provider.normalize(other), []);
  }
});

Deno.test("a checkout session of another mode, or without our organisation id, gives no event", () => {
  const provider = stripe();
  const session = (patch: Record<string, unknown>) => ({
    ...checkoutCompleted,
    data: { object: { ...checkoutCompleted.data.object, ...patch } },
  });
  assert.deepEqual(provider.normalize(session({ mode: "payment" })), []);
  assert.deepEqual(provider.normalize(session({ client_reference_id: "not-a-uuid" })), []);
  assert.deepEqual(provider.normalize(session({ client_reference_id: null })), []);
});

Deno.test("no normalised event holds a name, an address or an email of the payer", () => {
  const all = [checkoutCompleted, created, updated, deleted, trialWillEnd, invoicePaid, invoiceFailed, basil]
    .flatMap((event) => stripe().normalize(event));
  assert.equal(all.length, 8);
  assert.doesNotMatch(JSON.stringify(all), /billing@example|Acme Bau|Hauptstrasse|customer_email|customer_name/);
});

Deno.test("FR-G3 AC1: a Stripe delivery is verified on the raw body with every rule of the signature", async () => {
  const body = raw(created);
  const t = Math.floor(NOW / 1000);
  const verify = async (request: Promise<Request>, text = body, now = NOW) =>
    await stripe(now).verifyWebhook(await request, text);

  const accepted = await verify(stripeRequest(body));
  assert.deepEqual(accepted, {
    ok: true,
    eventId: "evt_sub_created",
    type: "customer.subscription.created",
    payload: created,
  });

  const reasons = {
    changedByte: await verify(stripeRequest(body), body.replace("trialing", "trialinG")),
    reserialised: await verify(stripeRequest(body), JSON.stringify(created)),
    otherSecret: await verify(stripeRequest(body, `t=${t},v1=${await hmacHex("whsec_other", `${t}.${body}`)}`)),
    missing: await verify(stripeRequest(body, "")),
    noV1: await verify(stripeRequest(body, `t=${t}`)),
    notHex: await verify(stripeRequest(body, `t=${t},v1=zz`)),
    noTimestamp: await verify(stripeRequest(body, `v1=${await hmacHex(SECRET, `${t}.${body}`)}`)),
    tooOld: await verify(stripeRequest(body, `t=${t - 301},v1=${await hmacHex(SECRET, `${t - 301}.${body}`)}`)),
    inTheFuture: await verify(stripeRequest(body, `t=${t + 301},v1=${await hmacHex(SECRET, `${t + 301}.${body}`)}`)),
  };
  assert.deepEqual(
    Object.fromEntries(Object.entries(reasons).map(([name, result]) => [name, result.ok ? "ok" : result.reason])),
    {
      changedByte: "signature_mismatch",
      reserialised: "signature_mismatch",
      otherSecret: "signature_mismatch",
      missing: "missing_signature",
      noV1: "malformed_signature",
      notHex: "signature_mismatch",
      noTimestamp: "malformed_signature",
      tooOld: "timestamp_outside_tolerance",
      inTheFuture: "timestamp_outside_tolerance",
    },
  );

  const edge = await verify(stripeRequest(body, `t=${t - 299},v1=${await hmacHex(SECRET, `${t - 299}.${body}`)}`));
  assert.equal(edge.ok, true, "a delivery 299 seconds old is accepted");
});

Deno.test("FR-G3 AC1: a secret that is rotated signs with two v1 values, and either is accepted", async () => {
  const body = raw(created);
  const t = Math.floor(NOW / 1000);
  const header = `t=${t},v1=${await hmacHex("whsec_old", `${t}.${body}`)},v1=${await hmacHex(SECRET, `${t}.${body}`)}`;
  assert.equal((await stripe().verifyWebhook(await stripeRequest(body, header), body)).ok, true);
});

Deno.test("FR-G3 AC1: a signed body that is not JSON, or has no event id, is refused after the signature", async () => {
  for (
    const body of ["not json", "[]", JSON.stringify({ type: "invoice.paid" }), JSON.stringify({ id: "", type: "x" })]
  ) {
    const result = await stripe().verifyWebhook(await stripeRequest(body), body);
    assert.deepEqual(result, { ok: false, reason: "invalid_payload" });
  }
});

Deno.test("a Stripe provider without a signing secret verifies nothing", async () => {
  const provider = stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetch, () => NOW);
  assert.deepEqual(await provider.verifyWebhook(await stripeRequest(raw(created)), raw(created)), {
    ok: false,
    reason: "not_configured",
  });
});

Deno.test("FR-G3 AC1: the null provider verifies x-chara-signature, and Stripe's header means nothing to it", async () => {
  const provider = nullProvider(SITE, "null-secret");
  const body = JSON.stringify({
    id: "evt_n1",
    event: { kind: "payment.failed", providerCreatedAt: "2026-11-01T10:00:00.000Z" },
  });
  const request = (headers: Record<string, string>) =>
    new Request("http://stack.test/", { method: "POST", headers, body });

  const ok = await provider.verifyWebhook(request({ "x-chara-signature": await hmacHex("null-secret", body) }), body);
  assert.deepEqual(ok, { ok: true, eventId: "evt_n1", type: "payment.failed", payload: JSON.parse(body).event });
  assert.deepEqual(
    await provider.verifyWebhook(request({ "x-chara-signature": await hmacHex("other", body) }), body),
    { ok: false, reason: "signature_mismatch" },
  );
  assert.deepEqual(await provider.verifyWebhook(request({}), body), { ok: false, reason: "missing_signature" });
  const t = Math.floor(NOW / 1000);
  assert.deepEqual(
    await provider.verifyWebhook(
      request({ "stripe-signature": `t=${t},v1=${await hmacHex("null-secret", `${t}.${body}`)}` }),
      body,
    ),
    { ok: false, reason: "missing_signature" },
  );
  assert.deepEqual(
    await nullProvider(SITE).verifyWebhook(request({ "x-chara-signature": await hmacHex("any", body) }), body),
    { ok: false, reason: "not_configured" },
  );
});

Deno.test("the null provider takes an event that is already normalised and refuses anything else", () => {
  const provider = nullProvider(SITE, "s");
  const event = {
    kind: "payment.failed",
    providerCreatedAt: "2026-11-01T10:00:00.000Z",
    providerSubscriptionRef: "sub_1",
  };
  assert.deepEqual(provider.normalize(event), [event]);
  for (
    const bad of [
      { kind: "refund.issued", providerCreatedAt: "2026-11-01T10:00:00.000Z" },
      { kind: "payment.failed" },
      { kind: "payment.failed", providerCreatedAt: "soon" },
      null,
    ]
  ) {
    assert.deepEqual(provider.normalize(bad), []);
  }
});

function jsonFetch(
  responses: unknown[],
): { fetchFn: typeof fetch; seen: { url: string; method: string; authorization: string }[] } {
  const seen: { url: string; method: string; authorization: string }[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: (init?.headers as Record<string, string>).authorization,
    });
    return Promise.resolve(Response.json(responses[seen.length - 1]));
  };
  return { fetchFn, seen };
}

Deno.test("fetchSubscription reads the subscription as Stripe holds it now and creates the event at the time of the fetch", async () => {
  const { fetchFn, seen } = jsonFetch([created.data.object]);
  const provider = stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn);
  const event = await provider.fetchSubscription("sub_1Nx", new Date("2026-11-03T12:00:00Z"));
  assert.deepEqual(seen, [{
    url: "https://api.stripe.com/v1/subscriptions/sub_1Nx",
    method: "GET",
    authorization: "Bearer sk_test_x",
  }]);
  assert.equal(event?.kind, "subscription.updated");
  assert.equal(event?.providerCreatedAt, "2026-11-03T12:00:00.000Z");
  assert.equal((event as { planCode?: string }).planCode, "employer_starter");

  const canceled = jsonFetch([deleted.data.object]);
  const gone = await stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, canceled.fetchFn).fetchSubscription(
    "sub_1Nx",
    new Date(),
  );
  assert.equal(gone?.kind, "subscription.canceled");
});

Deno.test("fetchSubscription refuses a reference that is not a subscription id, before any call", async () => {
  const { fetchFn, seen } = jsonFetch([]);
  const provider = stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn);
  for (const bad of ["../customers/cus_1", "sub_1?expand[]=x", "cus_1", ""]) {
    await assert.rejects(() => provider.fetchSubscription(bad, new Date()), { code: "stripe_bad_reference" });
  }
  assert.equal(seen.length, 0);
});

Deno.test("listSubscriptions reads a page of 100 and the cursor of the next one", async () => {
  const { fetchFn, seen } = jsonFetch([
    { data: [created.data.object, updated.data.object, { id: "sub_x", status: "incomplete" }], has_more: true },
    { data: [], has_more: false },
  ]);
  const provider = stripeProvider({ secretKey: "sk_test_x", siteUrl: SITE }, fetchFn);
  const first = await provider.listSubscriptions();
  assert.deepEqual(first, {
    subscriptions: [
      { providerSubscriptionRef: "sub_1Nx", status: "trialing", planCode: "employer_starter" },
      { providerSubscriptionRef: "sub_1Nx", status: "active", planCode: "employer_professional" },
    ],
    next: "sub_x",
  });
  assert.deepEqual(await provider.listSubscriptions("sub_x"), { subscriptions: [], next: null });
  assert.deepEqual(seen.map((call) => call.url), [
    "https://api.stripe.com/v1/subscriptions?limit=100",
    "https://api.stripe.com/v1/subscriptions?limit=100&starting_after=sub_x",
  ]);
});
