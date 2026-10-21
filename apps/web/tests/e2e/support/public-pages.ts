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

// The links of the header of a visitor on a desktop (OPEN_QUESTIONS.md D90): three links, Post a Job and Sign in, and no
// Menu button (a phone's); on the For employers page For job seekers replaces Find Jobs and For employers. The other pages
// about Chara Pinnacle are in the footer (P18).
export const HEADER_LABELS = ["Find jobs", "For employers", "How it works", "Post a job", "Sign in"];
// What innerText reads: buttons and header links are drawn in Title Case (text-transform), their text stays as written.
export const titleCase = (label: string) => label.replace(/(^|\s)\S/g, (start) => start.toUpperCase());
export const HEADER_SHOWN = HEADER_LABELS.map(titleCase);
export const EMPLOYERS_HEADER_LABELS = ["For job seekers", "How it works", "Post a job", "Sign in"];

// The menu panel: the Explore links, the client's later-phase navigation as text, and the account actions.
export const MENU_LINKS = ["Find jobs", "For employers", "For job seekers", "How Chara Pinnacle works"];
export const LATER_PHASE = ["Find workers", "Request workers", "Find companies", "Recruitment partners", "Staffing partners", "Workforce corridors", "Job orders"];

// The footer reads in three columns: Platform, Company and Legal.
export const FOOTER_LABELS = [
  "Find jobs",
  "For employers",
  "How Chara Pinnacle works",
  "Pricing",
  "About",
  "Trust & Safety",
  "Contact",
  "Imprint",
  "Privacy Policy",
  "Terms of Service",
  "Cookie Policy",
  "All legal documents",
];

// The h2 of the home page's sections in reading order when no live figure is credible (U73, OPEN_QUESTIONS.md D90); the
// employer band between the passport and the closing call is named by its aria-label, not a heading.
export const HOME_SECTION_HEADINGS = [
  "From profile to offer, in three steps.",
  "One professional profile. Multiple opportunities.",
  "Your Workforce. Your Network. One Platform.",
];

// The h2 of the For employers page in reading order.
export const EMPLOYERS_SECTION_HEADINGS = [
  "From vacancy to hire in three steps.",
  "Built for teams that hire together.",
  "Pricing",
  "Ready to hire?",
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

// The nine pages of AC6 and AC10, with the vacancy page of the given id, and the For employers page (U73).
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
    "/en/employers",
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
