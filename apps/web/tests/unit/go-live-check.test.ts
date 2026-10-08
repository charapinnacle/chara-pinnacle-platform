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
    ["false", '{"entitlements_enforced": false}', "false"],
    ["missing", '{"audit_retention_years": 6}', "missing"],
    ["an empty export", "{}", "missing"],
    ['a string that is not "true"', '{"entitlements_enforced": "false"}', '"false"'],
    ['the text off', '{"entitlements_enforced": "off"}', '"off"'],
    ["null", '{"entitlements_enforced": null}', "null"],
  ])("fails and names the setting when entitlements_enforced is %s", (_, exported, found) => {
    const result = run(exported);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("entitlements_enforced");
    expect(result.stderr).toContain(`found: ${found}`);
  });

  it.each([
    ["jsonb true", '{"entitlements_enforced": true}'],
    ['jsonb "true"', '{"entitlements_enforced": "true"}'],
    ['the text TRUE', '{"entitlements_enforced": "TRUE"}'],
    ['the text on, as the database casts it', '{"entitlements_enforced": "on"}'],
    ['the text " yes " with spaces', '{"entitlements_enforced": " yes "}'],
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
    const ENFORCED = '{"entitlements_enforced": true}';
    expect(run(ENFORCED, null).status).toBe(2);
    expect(run(ENFORCED, null).stderr).toContain("Usage");
    expect(run(ENFORCED, "not json").status).toBe(2);
    expect(run(ENFORCED, '{"plans": "none"}').status).toBe(2);
  });
});

describe("the go-live gate for the plans that are sold (FR-G1 AC11)", () => {
  const ENFORCED = '{"entitlements_enforced": true}';

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
    const result = run('{"entitlements_enforced": false}', [...notSold, sold("employer_starter", 3900, { stripe_amount: 3800 })]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("entitlements_enforced must be true");
    expect(result.stderr).toContain("plan employer_starter: Stripe holds 3800");
  });

  it("does not ask the plans that are not sold for a price", () => {
    expect(run(ENFORCED, notSold).status).toBe(0);
  });
});
