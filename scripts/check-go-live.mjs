#!/usr/bin/env node
// Go-live gate: fails when plan limits are not enforced (FR-C6), when a plan that is sold cannot be bought as stated
// (FR-G1 AC11), when the legal-entity name, its address or one of the two privacy contacts that the public pages show
// is empty (FR-H1 AC12), when the platform has no active administrator, when a current legal document is still a draft,
// or when the Vault secret that makes the visitor throttle check its proof is not set (security review SA-08, SA-02), in
// the environment that is about to go live.
// Usage: node scripts/check-go-live.mjs [--allow-draft-legal] <settings.json> <plans.json> <release.json>, where the
// first file is the production export of private.settings as one JSON object, the second is the output of
// `node scripts/sync-stripe-plans.mjs --export` (docs/runbooks/plan-limits.md section 3, docs/runbooks/checkout.md) and
// the third the export of the release facts (docs/runbooks/security-checklist.md section 2). The database reads the
// value as text and casts it to a boolean, so every form Postgres reads as true means on: jsonb true, and the text true,
// t, yes, y, on or 1 in any case. A legal-entity value is empty when it is missing, null or only white space.
// --allow-draft-legal lets draft legal texts pass, for a launch that counsel has not cleared yet; the gate still names
// them. The Auth settings that no export can show are checked by hand (security-checklist.md section 3).
import { readFileSync } from "node:fs";
import { isSold } from "./sync-stripe-plans.mjs";

const LIMIT_KEYS = ["active_jobs", "members"];
const LEGAL_ENTITY_KEYS = ["legal_entity_name", "legal_entity_address", "privacy_contact", "data_protection_contact"];
const ALLOW_DRAFT_LEGAL = "--allow-draft-legal";
const USAGE = `Usage: node scripts/check-go-live.mjs [${ALLOW_DRAFT_LEGAL}] <settings.json> <plans.json> <release.json>\n`;

function unreadable(file) {
  process.stderr.write(`Go-live check failed: ${file} is not a readable JSON export\n`);
  process.exit(2);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    unreadable(file);
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

const args = process.argv.slice(2);
const allowDraftLegal = args.includes(ALLOW_DRAFT_LEGAL);
const files = args.filter((arg) => arg !== ALLOW_DRAFT_LEGAL);
const [settingsFile, plansFile, releaseFile] = files;
if (files.length !== 3) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const settings = readJson(settingsFile);
const plans = readJson(plansFile)?.plans;
if (!Array.isArray(plans)) unreadable(plansFile);
const release = readJson(releaseFile);
const legalDocuments = release?.current_legal_documents;
if (!Array.isArray(legalDocuments)) unreadable(releaseFile);

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
const administrators = release.active_administrators;
if (!Number.isInteger(administrators) || administrators < 1) {
  failures.push(`the platform needs an active administrator (found: ${JSON.stringify(administrators ?? null)})`);
}
if (release.rate_limit_proof_key_set !== true) {
  failures.push("the Vault secret rate_limit_proof_key is not set: anyone can spend the visitor throttles (security-checklist.md item 10)");
}
if (legalDocuments.length === 0) {
  failures.push("no legal document is published");
}
const drafts = legalDocuments.filter((document) => document.is_draft !== false).map(({ slug, version }) => `${slug} v${version}`);
if (drafts.length > 0 && !allowDraftLegal) {
  failures.push(`legal documents are drafts: ${drafts.join(", ")} (publish the approved texts, or pass ${ALLOW_DRAFT_LEGAL})`);
}

if (failures.length > 0) {
  process.stderr.write(failures.map((failure) => `Go-live check failed: ${failure}\n`).join(""));
  process.exit(1);
}
process.stdout.write(
  "Go-live check passed: entitlements_enforced is on, every sold plan is mirrored at Stripe, the legal-entity details are set, an administrator is active and the throttle proof key is set\n",
);
if (drafts.length > 0) {
  process.stdout.write(`Draft legal documents allowed by ${ALLOW_DRAFT_LEGAL}: ${drafts.join(", ")}\n`);
}
process.stdout.write("Check the Auth settings by hand: docs/runbooks/security-checklist.md section 3\n");
