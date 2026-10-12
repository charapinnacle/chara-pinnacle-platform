import { BRAND_NAME } from "@/lib/brand";

// The links of the header that are the same for everybody, and the two that only a visitor needs. The owner keeps the
// header to the two ways in (OPEN_QUESTIONS.md, owner decision 2026-10-10): the pages about the platform are in the footer.
// Post a Job, between them and the account links, comes from the client's website structure (OPEN_QUESTIONS.md D81, question P22).
export const siteLinks = [
  { path: "jobs", label: "Find Jobs" },
  { path: "how-it-works", label: `How ${BRAND_NAME} works` },
] as const;

export const guestLinks = [
  { path: "login", label: "Login" },
  { path: "signup", label: "Sign up" },
] as const;

export const LEGAL_INDEX_PATH = "legal";

export const PHOTO_CREDITS_ID = "photo-credits";
const PHOTO_CREDITS_PATH = `imprint#${PHOTO_CREDITS_ID}`;

// The billing terms are not shown to a signed-in person who is not an employer: a candidate's pages hold no billing link (FR-G6 AC5).
export const BILLING_TERMS_PATH = "legal/subscription-and-billing-terms";

// The public footer: three quiet columns under the logo. Every legal document is two clicks away from every page (the last
// link leads to the index). The credits of the licensed photographs of the home page are a section of the Imprint.
export const publicFooterColumns = [
  {
    title: "Platform",
    links: [
      { path: "jobs", label: "Find Jobs" },
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
      { path: PHOTO_CREDITS_PATH, label: "Photo credits" },
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
