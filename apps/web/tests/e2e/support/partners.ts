import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { env } from "@/lib/env";
import { callAs } from "./accounts";
import { choose } from "./combobox";
import { execute, literal } from "./db";
import { logIn } from "./login-page";
import { organizationRows, uniqueToken } from "./organizations";
import { documentBox, PASSWORD } from "./signup-page";
import { expect } from "./test";
import { adminRequest, type TestUser } from "./test-user";

export type PartnerType = "recruitment_company" | "staffing_company";

export const PARTNER_LABEL: Record<PartnerType, string> = {
  recruitment_company: "I'm a recruitment company",
  staffing_company: "I'm a staffing company",
};

export const PARTNER_IDENTIFIER_LABEL = "Company registration number, VAT number or other identifier";
export const DRAFT_NOTICE = "Draft - not yet approved by legal counsel.";

// The switch of release 2a, for the whole database: the specs that set it run in a project of their own.
export function setPartnerRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_partner_directories'`);
}

interface DocumentRow {
  slug: string;
  title: string;
  version: number;
}

// The documents of a partner type, as the sign-up page reads them (release 2a must be on).
export async function partnerDocuments(type: PartnerType): Promise<DocumentRow[]> {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/signup_documents`, {
    method: "POST",
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ p_kind: "company", p_org_type: type }),
  });
  if (!response.ok) throw new Error(`signup_documents answered ${response.status}`);
  return (await response.json()) as DocumentRow[];
}

// A confirmed partner user whose kind is committed with the documents of the type, without an organisation and without
// a session.
export async function createCommittedPartner(type: PartnerType): Promise<TestUser> {
  const email = `e2e-partner-${randomUUID()}@example.test`;
  const password = `Pw-${randomUUID()}`;
  const pending = (await partnerDocuments(type)).map(({ slug, version }) => ({ purpose: slug, version }));
  const response = await adminRequest("/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { intended_account_kind: "company", intended_organization_type: type, pending_consents: pending },
    }),
  });
  const { id } = (await response.json()) as { id: string };
  const user = { id, email, password };
  await callAs(user, "set_account_kind");
  execute(`delete from auth.sessions where user_id = ${literal(id)}`);
  return user;
}

// The sign-up form filled for a partner type, with every document of the type accepted.
export async function fillPartnerSignup(page: Page, type: PartnerType, email: string): Promise<void> {
  await page.getByRole("radio", { name: PARTNER_LABEL[type] }).check();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  for (const { title } of await partnerDocuments(type)) await documentBox(page, title).check();
}

// The description every test partner gives: a partner describes itself in at least 50 characters.
export const PARTNER_DESCRIPTION = "We recruit welders and electricians from the Philippines for employers in Germany.";

// The Company step of partner onboarding, for a company based in the Philippines. A partner has no industry of its own.
export async function fillPartnerCompany(
  page: Page,
  details: { legalName: string; displayName?: string; identifier?: string; description?: string },
): Promise<void> {
  await page.getByLabel("Legal company name").fill(details.legalName);
  if (details.displayName) await page.getByLabel("Display name (optional)").fill(details.displayName);
  await choose(page, "Country where you are based", "Philippines");
  await page.getByLabel("Website (optional)").fill("https://manila-skills.example");
  if (details.identifier) {
    await page.getByLabel(PARTNER_IDENTIFIER_LABEL).fill(details.identifier);
    await page.getByLabel("Type of identifier", { exact: true }).selectOption({ value: "registration_number" });
  }
  await page.getByLabel("About your company", { exact: true }).fill(details.description ?? PARTNER_DESCRIPTION);
}

export async function openPartnerOnboarding(page: Page, user: TestUser): Promise<void> {
  await logIn(page, user);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  await page.goto("/en/onboarding");
}

// A partner owner with a company based in the Philippines, and the slug and id of the company.
export async function partnerWithCompany(type: PartnerType): Promise<{ user: TestUser; id: string; slug: string }> {
  const user = await createCommittedPartner(type);
  const token = uniqueToken();
  await callAs(user, "create_organization", {
    p_type: type,
    p_legal_name: `Manila Skills ${token} Inc.`,
    p_display_name: `Manila Skills ${token}`,
    p_based_in_country: "PH",
    p_industry_code: "",
    p_identifier: `MS${token}`.slice(0, 32),
    p_identifier_kind: "registration_number",
    p_description: PARTNER_DESCRIPTION,
  });
  const [organization] = organizationRows(user.id);
  return { user, id: organization.id, slug: organization.slug };
}

// The organisation lapsed to its free plan: the plan limits of the Basic tier (3 markets, 10 occupations) apply to it
// whatever entitlements_enforced says.
export function lapseToFreePlan(organizationId: string): void {
  execute(
    `insert into billing.subscriptions (organization_id, plan_code, status, provider)
     values (${literal(organizationId)}, 'recruitment_partner', 'canceled', 'null')`,
  );
}

// The chips of a chips field.
export function chips(page: Page, label: string) {
  return page.getByRole("list", { name: `${label} chosen` }).getByRole("listitem");
}

// Types into the combobox and walks the list with the arrow keys to the option, then takes it with Enter.
export async function pickWithKeys(page: Page, label: string, typed: string, option: string): Promise<void> {
  const box = page.getByRole("combobox", { name: label, exact: true });
  await box.focus();
  await page.keyboard.type(typed);
  await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
  for (let step = 0; step < 20; step++) {
    const active = await box.getAttribute("aria-activedescendant");
    if (active && (await page.locator(`[id="${active}"]`).innerText()).trim() === option) break;
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
}
