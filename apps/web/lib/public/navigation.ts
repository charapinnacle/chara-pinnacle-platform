import { BRAND_NAME } from "@/lib/brand";
import type { Database } from "@chara-pinnacle/db-types";
import type { ReleaseSwitch } from "@/lib/release";

export const EMPLOYERS_PATH = "employers";
export const RECRUITMENT_DIRECTORY_PATH = "partners/recruitment";
export const STAFFING_DIRECTORY_PATH = "partners/staffing";
export const JOB_ORDERS_PATH = "job-orders";
export const FIND_COMPANIES_PATH = "companies";
export const FIND_WORKERS_PATH = "find-workers";
export const REQUEST_WORKERS_PATH = "request-workers";
export const CORRIDORS_PATH = "corridors";
export const NETWORK_PATH = "network";

// The header shows a few links (OPEN_QUESTIONS.md D90, which replaces the header lists of P18 and P22): Find Jobs and For
// employers on every public page, For job seekers instead of both on the For employers page, How it works, then Post a Job
// and Sign in; on a phone a Menu button opens the rest. Pricing, Trust & Safety, About and Contact stay in the
// footer only (P18).
export const headerLinks = [
  { path: "jobs", label: "Find jobs" },
  { path: EMPLOYERS_PATH, label: "For employers" },
] as const;

export const jobSeekersLink = { path: "", label: "For job seekers" } as const;

// The navigation of the client's structure (section 2) that Phase 1 does not have, in its order, with the release that
// makes an item a page and its address then (FR-L5). Until its release is on an item is named in the menu as plain text,
// never a link, so the client sees where it will go. The partner directories (release 2a), Job Orders (release 2b, V40),
// Find Companies (release 2b, V53), Find Workers (release 2c, V69) and Request Workers (release 2c, V71, a public page
// that leads employers to the staffing partners) exist, and so do the Workforce corridors (release_corridors); an item's
// path and release here also put it in the sitemap.
type NetworkFeature = { label: string; path: string; release: ReleaseSwitch };

export const networkFeatures: readonly NetworkFeature[] = [
  { label: "Find workers", path: FIND_WORKERS_PATH, release: "release_find_workers" },
  { label: "Request workers", path: REQUEST_WORKERS_PATH, release: "release_messaging" },
  { label: "Find companies", path: FIND_COMPANIES_PATH, release: "release_job_orders" },
  { label: "Recruitment partners", path: RECRUITMENT_DIRECTORY_PATH, release: "release_partner_directories" },
  { label: "Staffing partners", path: STAFFING_DIRECTORY_PATH, release: "release_partner_directories" },
  { label: "Workforce corridors", path: CORRIDORS_PATH, release: "release_corridors" },
  { label: "Job orders", path: JOB_ORDERS_PATH, release: "release_job_orders" },
];

export const laterPhaseFeatures = networkFeatures.map(({ label }) => label);

// The items of the network for the release switches that are on: a released item is a link, the others stay labels.
export function networkMenu(released: readonly ReleaseSwitch[]): { links: { path: string; label: string }[]; later: string[] } {
  const links: { path: string; label: string }[] = [];
  const later: string[] = [];
  for (const { label, path, release } of networkFeatures) {
    if (released.includes(release)) links.push({ path, label });
    else later.push(label);
  }
  return { links, later };
}

// Every page of the network serves companies (employers and partners), none a person looking for work.
const companyPaths = new Set<string>([EMPLOYERS_PATH, ...networkFeatures.map(({ path }) => path)]);

// A signed-in worker is not offered the employer's or a partner's side of the site, and a signed-in company not the job
// seeker's.
export function forAccountKind<T extends { path: string }>(
  links: readonly T[],
  accountKind: Database["public"]["Enums"]["account_kind"] | null | undefined,
): T[] {
  if (accountKind === "worker") return links.filter(({ path }) => !companyPaths.has(path));
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

export const LEGAL_INDEX_PATH = "legal";

// The billing terms are not shown to a signed-in person who is not an employer: a candidate's pages hold no billing link (FR-G6 AC5).
export const BILLING_TERMS_PATH = "legal/subscription-and-billing-terms";

// Pricing is hidden from the public site until the client shows it again; /pricing itself is still served.
export const SHOW_PRICING = false;

// The public footer: three quiet columns under the logo. Every legal document is two clicks away from every page (the last
// link leads to the index).
export const publicFooterColumns = [
  {
    title: "Platform",
    links: [
      { path: "jobs", label: "Find jobs" },
      { path: EMPLOYERS_PATH, label: "For employers" },
      { path: "how-it-works", label: `How ${BRAND_NAME} works` },
      ...(SHOW_PRICING ? [{ path: "pricing", label: "Pricing" }] : []),
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

const slugsOf = (groups: typeof legalGroups) =>
  groups.flatMap(({ links }) => links).flatMap(({ path }) => (path.startsWith("legal/") ? [path.slice("legal/".length)] : []));

// The slugs of the legal pages that the index links to; the sitemap asks the database which of them are published.
export const legalSlugs = slugsOf(legalGroups);

export const IMMIGRATION_DISCLAIMER_PATH = "legal/immigration-disclaimer";

// The partner legal documents of Phase 2 (FR-S4). Their pages exist, and the index lists them, only while release 2a
// (release_partner_directories) is on: until then they are drafts about features nobody can use, so they are not
// published to visitors or to the sitemap.
export const partnerLegalGroups: typeof legalGroups = [
  {
    title: "Partner network",
    links: [
      { path: "legal/partner-terms", label: "Partner Terms" },
      { path: "legal/recruitment-company-terms", label: "Recruitment Company Terms" },
      { path: "legal/staffing-company-terms", label: "Staffing Company Terms" },
      { path: "legal/employer-pays-commitment", label: "Employer-Pays Commitment" },
    ],
  },
  {
    title: "Partner data and notices",
    links: [
      { path: "legal/partner-dpa", label: "Data Processing Agreement for Partners" },
      { path: "legal/worker-visibility-consent", label: "Worker Visibility Consent" },
      { path: IMMIGRATION_DISCLAIMER_PATH, label: "Immigration, Visa and Legal Advice Disclaimer" },
    ],
  },
];

export const partnerLegalSlugs = slugsOf(partnerLegalGroups);

// How Find Partners orders its results (NFR-C8, V77): a page of the code, not a legal document, so it has no version. It
// exists, and the index of legal documents and the sitemap name it, only while release 2a is on.
export const RANKING_PATH = "legal/ranking";

export const rankingGroup = {
  title: "Search and ranking",
  links: [{ path: RANKING_PATH, label: "How search results are ranked" }],
} as const;

// The pages of the releases that are on, for the sitemap: the network pages of the menu and the ranking page.
export function releasedPagePaths(released: readonly ReleaseSwitch[]): string[] {
  const network = networkMenu(released).links.map(({ path }) => path);
  return released.includes("release_partner_directories") ? [...network, RANKING_PATH] : network;
}
