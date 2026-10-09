import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../../scripts/check-go-live.mjs", import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "go-live-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Plan = Record<string, unknown>;

const sold = (code: string, price: number, overrides: Plan = {}): Plan => ({
  code,
  is_public: true,
  contact_sales: false,
  price_minor: price,
  limits: { active_jobs: 3, members: 1 },
  price_ref: `price_${code}`,
  stripe_amount: price,
  ...overrides,
});

const notSold: Plan[] = [
  { code: "free_employer", is_public: false, contact_sales: false, price_minor: 0, limits: {}, price_ref: null, stripe_amount: null },
  { code: "employer_enterprise", is_public: false, contact_sales: true, price_minor: 0, limits: {}, price_ref: null, stripe_amount: null },
];

const MIRRORED: Plan[] = [...notSold, sold("employer_starter", 3900), sold("employer_professional", 7900)];

const ENTITY = {
  legal_entity_name: "Example GmbH",
  legal_entity_address: "1 Example Street, 20095 Hamburg",
  privacy_contact: "privacy@example.com",
  data_protection_contact: "dpo@example.com",
};

// The export of private.settings with the legal-entity details set, so that a test of another gate is not about them.
const settings = (enforced: unknown, entity: Record<string, unknown> = ENTITY) =>
  JSON.stringify({ entitlements_enforced: enforced, ...entity });

function run(exported: string | null, plans: Plan[] | string | null = MIRRORED) {
  const args = [script];
  if (exported !== null) {
    const file = path.join(dir, "settings.json");
    writeFileSync(file, exported);
    args.push(file);
    if (plans !== null) {
      const plansFile = path.join(dir, "plans.json");
      writeFileSync(plansFile, typeof plans === "string" ? plans : JSON.stringify({ plans }));
      args.push(plansFile);
    }
  }
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

describe("the go-live gate for plan limits (FR-C6 AC12)", () => {
  it.each([
    ["false", settings(false), "false"],
    ["missing", JSON.stringify({ audit_retention_years: 6, ...ENTITY }), "missing"],
    ["an empty export", "{}", "missing"],
    ['a string that is not "true"', settings("false"), '"false"'],
    ["the text off", settings("off"), '"off"'],
    ["null", settings(null), "null"],
  ])("fails and names the setting when entitlements_enforced is %s", (_, exported, found) => {
    const result = run(exported);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("entitlements_enforced");
    expect(result.stderr).toContain(`found: ${found}`);
  });

  it.each([
    ["jsonb true", settings(true)],
    ['jsonb "true"', settings("true")],
    ["the text TRUE", settings("TRUE")],
    ["the text on, as the database casts it", settings("on")],
    ['the text " yes " with spaces', settings(" yes ")],
  ])("passes when entitlements_enforced is %s", (_, exported) => {
    const result = run(exported);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("fails with a usage error when no file is given and when the file is not JSON", () => {
    const none = run(null);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain("Usage");
    const broken = run("not json");
    expect(broken.status).toBe(2);
    expect(broken.stderr).toContain("not a readable JSON export");
  });

  it("fails with a usage error when the plans file is missing or is not an export of the plans", () => {
    const ENFORCED = settings(true);
    expect(run(ENFORCED, null).status).toBe(2);
    expect(run(ENFORCED, null).stderr).toContain("Usage");
    expect(run(ENFORCED, "not json").status).toBe(2);
    expect(run(ENFORCED, '{"plans": "none"}').status).toBe(2);
  });
});

describe("the go-live gate for the plans that are sold (FR-G1 AC11)", () => {
  const ENFORCED = settings(true);

  it("passes when every sold plan has both limit rows, a stored price reference and the amount at Stripe", () => {
    const result = run(ENFORCED);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it.each([
    ["a limit row is missing", [...notSold, sold("employer_starter", 3900, { limits: { active_jobs: 3 } })], "plan employer_starter has no limit row for members"],
    ["no price reference is stored", [...notSold, sold("employer_professional", 7900, { price_ref: null, stripe_amount: null })], "plan employer_professional has no stored price reference"],
    ["Stripe holds another amount", [...notSold, sold("employer_starter", 3900, { stripe_amount: 4200 })], "plan employer_starter: Stripe holds 4200 but price_minor is 3900"],
    ["the stored price is not active at Stripe", [...notSold, sold("employer_starter", 3900, { stripe_amount: null })], "plan employer_starter: Stripe holds no active price for price_employer_starter"],
  ])("fails and names the plan when %s", (_, plans, message) => {
    const result = run(ENFORCED, plans);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it("takes a limit of null (unlimited) as a limit row", () => {
    expect(run(ENFORCED, [sold("employer_starter", 3900, { limits: { active_jobs: null, members: null } })]).status).toBe(0);
  });

  it("names the setting and the plan together when both fail", () => {
    const result = run(settings(false), [...notSold, sold("employer_starter", 3900, { stripe_amount: 3800 })]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("entitlements_enforced must be true");
    expect(result.stderr).toContain("plan employer_starter: Stripe holds 3800");
  });

  it("does not ask the plans that are not sold for a price", () => {
    expect(run(ENFORCED, notSold).status).toBe(0);
  });
});

describe("the go-live gate for the legal-entity details (FR-H1 AC12)", () => {
  it("passes when the name, the address and the two contacts are set", () => {
    const result = run(settings(true));
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("does not ask for the registration number, the VAT ID or the email, which a company may not have", () => {
    expect(run(settings(true, ENTITY)).status).toBe(0);
    expect(run(settings(true, { ...ENTITY, legal_entity_vat_id: "", legal_entity_email: "" })).status).toBe(0);
  });

  it.each(Object.keys(ENTITY))("fails and names %s when it is empty, white space, null or missing", (key) => {
    for (const value of ["", "   ", "\n\t", null]) {
      const result = run(settings(true, { ...ENTITY, [key]: value }));
      expect(result.status, `${key} = ${JSON.stringify(value)}`).toBe(1);
      expect(result.stderr).toContain(`${key} must not be empty`);
    }
    const missing = run(settings(true, Object.fromEntries(Object.entries(ENTITY).filter(([name]) => name !== key))));
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain(`${key} must not be empty`);
  });

  it("names every empty detail at once, with the other gates", () => {
    const result = run(settings(false, {}), [...notSold, sold("employer_starter", 3900, { stripe_amount: 3800 })]);
    expect(result.status).toBe(1);
    for (const key of Object.keys(ENTITY)) expect(result.stderr).toContain(`${key} must not be empty`);
    expect(result.stderr).toContain("entitlements_enforced must be true");
    expect(result.stderr).toContain("plan employer_starter: Stripe holds 3800");
  });
});
