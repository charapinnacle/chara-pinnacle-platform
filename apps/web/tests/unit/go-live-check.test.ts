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

type Release = { active_administrators?: unknown; current_legal_documents?: unknown };

const PUBLISHED: Release = {
  active_administrators: 2,
  current_legal_documents: [
    { slug: "privacy-policy", version: 1, is_draft: false },
    { slug: "terms-of-service", version: 2, is_draft: false },
  ],
};

// The settings, plans and release facts as files, in that order; a null file and every file after it are left out.
function run(
  exported: string | null,
  plans: Plan[] | string | null = MIRRORED,
  release: Release | string | null = PUBLISHED,
  flags: string[] = [],
) {
  const args = [script, ...flags];
  const files: [string, string | null][] = [
    ["settings.json", exported],
    ["plans.json", plans === null || typeof plans === "string" ? plans : JSON.stringify({ plans })],
    ["release.json", release === null || typeof release === "string" ? release : JSON.stringify(release)],
  ];
  for (const [name, content] of files) {
    if (content === null) break;
    writeFileSync(path.join(dir, name), content);
    args.push(path.join(dir, name));
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

describe("the go-live gate for the administrators and the legal texts (security review SA-08)", () => {
  const ENFORCED = settings(true);

  it("passes with an active administrator and published legal texts, and points to the checks made by hand", () => {
    const result = run(ENFORCED);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("an administrator is active");
    expect(result.stdout).toContain("docs/runbooks/security-checklist.md section 3");
  });

  it.each([
    ["no administrator", 0, "found: 0"],
    ["a count that is not a number", "2", 'found: "2"'],
    ["no count at all", undefined, "found: null"],
  ])("fails with %s", (_, administrators, found) => {
    const result = run(ENFORCED, MIRRORED, { ...PUBLISHED, active_administrators: administrators });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`the platform needs an active administrator (${found})`);
  });

  it("fails and names every draft while a current legal text is a draft", () => {
    const result = run(ENFORCED, MIRRORED, {
      ...PUBLISHED,
      current_legal_documents: [
        { slug: "privacy-policy", version: 0, is_draft: true },
        { slug: "terms-of-service", version: 2, is_draft: false },
        { slug: "cookie-policy", version: 1, is_draft: true },
      ],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("legal documents are drafts: privacy-policy v0, cookie-policy v1");
    expect(result.stderr).not.toContain("terms-of-service");
  });

  it("lets the drafts pass with the explicit flag, and still names them", () => {
    const release = { ...PUBLISHED, current_legal_documents: [{ slug: "privacy-policy", version: 0, is_draft: true }] };
    const result = run(ENFORCED, MIRRORED, release, ["--allow-draft-legal"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Draft legal documents allowed by --allow-draft-legal: privacy-policy v0");
  });

  it("does not let the flag pass anything else", () => {
    const result = run(settings(false), MIRRORED, { active_administrators: 0, current_legal_documents: [] }, ["--allow-draft-legal"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("entitlements_enforced must be true");
    expect(result.stderr).toContain("the platform needs an active administrator");
    expect(result.stderr).toContain("no legal document is published");
  });

  it("fails while plans are sold with enforcement off, whatever the other facts say", () => {
    const result = run(settings(false), MIRRORED, PUBLISHED);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("entitlements_enforced must be true (found: false)");
  });

  it("fails with a usage error when the release facts are missing or not an export of them", () => {
    expect(run(ENFORCED, MIRRORED, null).status).toBe(2);
    expect(run(ENFORCED, MIRRORED, null).stderr).toContain("Usage");
    expect(run(ENFORCED, MIRRORED, "not json").stderr).toContain("release.json is not a readable JSON export");
    expect(run(ENFORCED, MIRRORED, { active_administrators: 1 }).status).toBe(2);
  });
});
