import { execute, literal } from "./db";
import { newCompany, seedJob } from "./jobs";

export const LEGAL_SLUGS = [
  "terms-of-service",
  "privacy-policy",
  "cookie-policy",
  "platform-rules",
  "acceptable-use-policy",
  "subscription-and-billing-terms",
  "employer-terms",
  "worker-terms",
  "complaints-and-dispute-process",
  "account-suspension-and-termination-rules",
] as const;

export const HEADER_LABELS = ["Find Jobs", "Pricing", "How CHARA Works", "Trust & Safety", "About", "Contact", "Log in", "Sign up"];

export const FOOTER_LABELS = [
  "Imprint",
  "Terms of Service",
  "Privacy Policy",
  "Cookie Policy",
  "Platform Rules",
  "Acceptable Use Policy",
  "Complaints and Dispute Process",
  "Account Suspension and Termination Rules",
  "Subscription and Billing Terms",
  "Employer Terms",
  "Worker Terms",
];

export const SETTING_KEYS = [
  "legal_entity_name",
  "legal_entity_address",
  "legal_entity_registration_number",
  "legal_entity_vat_id",
  "legal_entity_email",
  "privacy_contact",
  "data_protection_contact",
] as const;

export async function openVacancyId(): Promise<string> {
  const company = await newCompany();
  return seedJob(company, { title: "Public pages welder", status: "open" });
}

// The nine pages of AC6 and AC10, with the vacancy page of the given id.
export function sitePaths(jobId: string): string[] {
  return [
    "/en",
    "/en/jobs",
    `/en/jobs/${jobId}`,
    "/en/pricing",
    "/en/how-it-works",
    "/en/trust-safety",
    "/en/about",
    "/en/contact",
    "/en/imprint",
  ];
}

export const legalPaths = (): string[] => LEGAL_SLUGS.map((slug) => `/en/legal/${slug}`);

export function setSettings(values: Partial<Record<(typeof SETTING_KEYS)[number], string>>): void {
  for (const [key, value] of Object.entries(values)) {
    execute(`update private.settings set value = to_jsonb(${literal(value)}::text) where key = ${literal(key)}`);
  }
}

export function clearSettings(): void {
  execute(`update private.settings set value = '""' where key in (${SETTING_KEYS.map(literal).join(", ")})`);
}
