import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { env } from "@/lib/env";
import { callAs } from "./accounts";
import { execute, literal } from "./db";
import { logIn } from "./login-page";
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

export async function openPartnerOnboarding(page: Page, user: TestUser): Promise<void> {
  await logIn(page, user);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  await page.goto("/en/onboarding");
}
