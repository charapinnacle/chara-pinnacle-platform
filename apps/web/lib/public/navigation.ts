// The links of the header that are the same for everybody, and the two that only a visitor needs. The owner keeps the
// header to the two ways in (OPEN_QUESTIONS.md, owner decision 2026-10-10): the pages about CHARA are in the footer.
export const siteLinks = [
  { path: "jobs", label: "Find Jobs" },
  { path: "how-it-works", label: "How CHARA Works" },
] as const;

// The pages about CHARA itself, as the first group of the public footer.
export const aboutLinks = [
  { path: "pricing", label: "Pricing" },
  { path: "how-it-works", label: "How CHARA Works" },
  { path: "trust-safety", label: "Trust & Safety" },
  { path: "about", label: "About" },
  { path: "contact", label: "Contact" },
] as const;

export const guestLinks = [
  { path: "login", label: "Log in" },
  { path: "signup", label: "Sign up" },
] as const;

// The terms of a subscription concern employers; the pages of a candidate hold no link about billing (FR-G6 AC5).
export const BILLING_TERMS_PATH = "legal/subscription-and-billing-terms";

// The Imprint and the legal pages of Phase 1. Whether a legal page exists is decided by the database (a published version
// of its slug), not by this list: the list only says which of them the footer links to.
export const footerGroups: readonly { title: string; links: readonly { path: string; label: string }[] }[] = [
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

// The slugs of the legal pages that the footer links to; the sitemap asks the database which of them are published.
export const legalSlugs = footerGroups.flatMap(({ links }) => links).flatMap(({ path }) => (path.startsWith("legal/") ? [path.slice("legal/".length)] : []));
