#!/usr/bin/env node
// Go-live gate: fails when plan limits are not enforced (FR-C6), when a plan that is sold cannot be bought as stated
// (FR-G1 AC11) or when the legal-entity name, its address or one of the two privacy contacts that the public pages show
// is empty (FR-H1 AC12), in the environment that is about to go live.
// Usage: node scripts/check-go-live.mjs <settings.json> <plans.json>, where the first file is the production export of
// private.settings as one JSON object and the second is the output of `node scripts/sync-stripe-plans.mjs --export`
// (docs/runbooks/plan-limits.md section 3, docs/runbooks/checkout.md). The database reads the value as text and casts
// it to a boolean, so every form Postgres reads as true means on: jsonb true, and the text true, t, yes, y, on or 1 in
// any case. A legal-entity value is empty when it is missing, null or only white space.
import { readFileSync } from "node:fs";
import { isSold } from "./sync-stripe-plans.mjs";

const LIMIT_KEYS = ["active_jobs", "members"];
const LEGAL_ENTITY_KEYS = ["legal_entity_name", "legal_entity_address", "privacy_contact", "data_protection_contact"];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    process.stderr.write(`Go-live check failed: ${file} is not a readable JSON export\n`);
    process.exit(2);
  }
}

function planFailures(plan) {
  const failures = [];
  for (const key of LIMIT_KEYS) {
    if (!Object.hasOwn(plan.limits ?? {}, key)) {
      failures.push(`plan ${plan.code} has no limit row for ${key}`);
    }
  }
  if (!plan.price_ref) {
    failures.push(`plan ${plan.code} has no stored price reference (run scripts/sync-stripe-plans.mjs)`);
  } else if (plan.stripe_amount === null || plan.stripe_amount === undefined) {
    failures.push(`plan ${plan.code}: Stripe holds no active price for ${plan.price_ref}`);
  } else if (plan.stripe_amount !== plan.price_minor) {
    failures.push(`plan ${plan.code}: Stripe holds ${plan.stripe_amount} but price_minor is ${plan.price_minor}`);
  }
  return failures;
}

const [settingsFile, plansFile] = process.argv.slice(2);
if (!settingsFile || !plansFile) {
  process.stderr.write("Usage: node scripts/check-go-live.mjs <settings.json> <plans.json>\n");
  process.exit(2);
}

const settings = readJson(settingsFile);
const plans = readJson(plansFile)?.plans;
if (!Array.isArray(plans)) {
  process.stderr.write(`Go-live check failed: ${plansFile} is not a readable JSON export\n`);
  process.exit(2);
}

const failures = [];
const enforced = settings?.entitlements_enforced;
const isOn = typeof enforced === "boolean" ? enforced : /^(t(r(ue?)?)?|y(es?)?|on|1)$/i.test(String(enforced).trim());
if (!isOn) {
  failures.push(
    `entitlements_enforced must be true (found: ${enforced === undefined ? "missing" : JSON.stringify(enforced)})`,
  );
}
for (const key of LEGAL_ENTITY_KEYS) {
  const value = settings?.[key];
  if (value === undefined || value === null || String(value).trim() === "") {
    failures.push(`${key} must not be empty: the Imprint, Contact and Privacy Policy pages show it`);
  }
}
for (const plan of plans.filter(isSold)) {
  failures.push(...planFailures(plan));
}

if (failures.length > 0) {
  process.stderr.write(failures.map((failure) => `Go-live check failed: ${failure}\n`).join(""));
  process.exit(1);
}
process.stdout.write(
  "Go-live check passed: entitlements_enforced is on, every sold plan is mirrored at Stripe and the legal-entity details are set\n",
);
