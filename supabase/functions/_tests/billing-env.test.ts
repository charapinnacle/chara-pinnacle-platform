import assert from "node:assert/strict";
import { billingProviderFromEnv } from "../_shared/billing/env.ts";

const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] });
const SITE = { SITE_URL: "https://app.chara.example" };

Deno.test("there is no default provider and no site address is no start", () => {
  assert.throws(() => billingProviderFromEnv(env({ ...SITE })), /BILLING_PROVIDER/);
  assert.throws(() => billingProviderFromEnv(env({ BILLING_PROVIDER: "null" })), /SITE_URL/);
  assert.throws(() => billingProviderFromEnv(env({ ...SITE, BILLING_PROVIDER: "paypal" })), /BILLING_PROVIDER/);
});

Deno.test("Stripe needs its secret key, and the webhook also its signing secret", () => {
  const stripe = { ...SITE, BILLING_PROVIDER: "stripe" };
  assert.throws(() => billingProviderFromEnv(env(stripe)), /STRIPE_SECRET_KEY/);
  assert.equal(billingProviderFromEnv(env({ ...stripe, STRIPE_SECRET_KEY: "sk_test_x" })).name, "stripe");
  assert.throws(
    () => billingProviderFromEnv(env({ ...stripe, STRIPE_SECRET_KEY: "sk_test_x" }), { webhook: true }),
    /STRIPE_WEBHOOK_SECRET/,
  );
  const both = { ...stripe, STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" };
  assert.equal(billingProviderFromEnv(env(both), { webhook: true }).name, "stripe");
});

Deno.test("the null provider needs its signing secret for the webhook only", () => {
  const nullEnv = { ...SITE, BILLING_PROVIDER: "null" };
  assert.equal(billingProviderFromEnv(env(nullEnv)).name, "null");
  assert.throws(() => billingProviderFromEnv(env(nullEnv), { webhook: true }), /BILLING_WEBHOOK_SECRET/);
  assert.equal(
    billingProviderFromEnv(env({ ...nullEnv, BILLING_WEBHOOK_SECRET: "s" }), { webhook: true }).name,
    "null",
  );
});
