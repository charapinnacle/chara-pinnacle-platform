import { BRAND_NAME } from "@/lib/brand";
import type { Database } from "@chara-pinnacle/db-types";

export const EMPLOYERS_PATH = "employers";

// The header shows a few links (OPEN_QUESTIONS.md D90, which replaces the header lists of P18 and P22): Find Jobs and For
// employers on every public page, For job seekers instead of both on the For employers page, How it works, then Post a Job
// and Sign in; on a phone a Menu button opens the rest. Pricing, Trust & Safety, About and Contact stay in the
// footer only (P18).
export const headerLinks = [
  { path: "jobs", label: "Find jobs" },
  { path: EMPLOYERS_PATH, label: "For employers" },
] as const;

export const jobSeekersLink = { path: "", label: "For job seekers" } as const;

// A signed-in worker is not offered the employer's side of the site, and a signed-in company not the job seeker's.
export function forAccountKind<T extends { path: string }>(
  links: readonly T[],
  accountKind: Database["public"]["Enums"]["account_kind"] | null | undefined,
): T[] {
  if (accountKind === "worker") return links.filter(({ path }) => path !== EMPLOYERS_PATH);
  if (accountKind === "company") return links.filter(({ path }) => path !== "jobs" && path !== jobSeekersLink.path);
  return [...links];
}

export const howItWorksLink = { path: "how-it-works", label: "How it works" } as const;

export const guestLinks = [
  { path: "login", label: "Sign in" },
  { path: "signup", label: "Sign up" },
] as const;

export const menuLinks = [
  { path: "jobs", label: "Find jobs" },
  { path: EMPLOYERS_PATH, label: "For employers" },
  jobSeekersLink,
  { path: "how-it-works", label: `How ${BRAND_NAME} works` },
] as const;

// The navigation of the client's structure (section 2) that Phase 1 does not have: named in the menu so the client sees
// where they will go, never a link.
export const laterPhaseFeatures = [
  "Find workers",
  "Request workers",
  "Find companies",
  "Recruitment partners",
  "Staffing partners",
  "Workforce corridors",
  "Job orders",
] as const;

export const LEGAL_INDEX_PATH = "legal";

// The billing terms are not shown to a signed-in person who is not an employer: a candidate's pages hold no billing link (FR-G6 AC5).
export const BILLING_TERMS_PATH = "legal/subscription-and-billing-terms";

// The public footer: three quiet columns under the logo. Every legal document is two clicks away from every page (the last
// link leads to the index).
export const publicFooterColumns = [
  {
    title: "Platform",
    links: [
      { path: "jobs", label: "Find jobs" },
      { path: EMPLOYERS_PATH, label: "For employers" },
      { path: "how-it-works", label: `How ${BRAND_NAME} works` },
      { path: "pricing", label: "Pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { path: "about", label: "About" },
      { path: "trust-safety", label: "Trust & Safety" },
      { path: "contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { path: "imprint", label: "Imprint" },
      { path: "legal/privacy-policy", label: "Privacy Policy" },
      { path: "legal/terms-of-service", label: "Terms of Service" },
      { path: "legal/cookie-policy", label: "Cookie Policy" },
      { path: LEGAL_INDEX_PATH, label: "All legal documents" },
    ],
  },
] as const;

// The small line at the foot of the signed-in area.
export const appFooterLinks = [
  { path: "legal/terms-of-service", label: "Terms" },
  { path: "legal/privacy-policy", label: "Privacy" },
  { path: "imprint", label: "Imprint" },
  { path: LEGAL_INDEX_PATH, label: "All legal documents" },
] as const;

// The Imprint and the legal pages of Phase 1, as the index of legal documents lists them. Whether a legal page exists is
// decided by the database (a published version of its slug), not by this list: the list only says which of them the
// index links to.
export const legalGroups: readonly { title: string; links: readonly { path: string; label: string }[] }[] = [
  {
    title: "Legal",
    links: [
      { path: "imprint", label: "Imprint" },
      { path: "legal/terms-of-service", label: "Terms of Service" },
      { path: "legal/privacy-policy", label: "Privacy Policy" },
      { path: "legal/cookie-policy", label: "Cookie Policy" },
    ],
  },
  {
    title: "Rules and disputes",
    links: [
      { path: "legal/platform-rules", label: "Platform Rules" },
      { path: "legal/acceptable-use-policy", label: "Acceptable Use Policy" },
      { path: "legal/complaints-and-dispute-process", label: "Complaints and Dispute Process" },
      { path: "legal/account-suspension-and-termination-rules", label: "Account Suspension and Termination Rules" },
    ],
  },
  {
    title: "Billing and roles",
    links: [
      { path: BILLING_TERMS_PATH, label: "Subscription and Billing Terms" },
      { path: "legal/employer-terms", label: "Employer Terms" },
      { path: "legal/worker-terms", label: "Worker Terms" },
    ],
  },
];

// The slugs of the legal pages that the index links to; the sitemap asks the database which of them are published.
export const legalSlugs = legalGroups.flatMap(({ links }) => links).flatMap(({ path }) => (path.startsWith("legal/") ? [path.slice("legal/".length)] : []));
