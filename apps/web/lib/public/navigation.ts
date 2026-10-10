export const headerLinks = [
  { path: "jobs", label: "Find Jobs" },
  { path: "pricing", label: "Pricing" },
  { path: "how-it-works", label: "How CHARA Works" },
  { path: "trust-safety", label: "Trust & Safety" },
  { path: "about", label: "About" },
  { path: "contact", label: "Contact" },
  { path: "login", label: "Log in" },
  { path: "signup", label: "Sign up" },
] as const;

const accountPaths = ["login", "signup"];

// The links of the header that are the same for everybody, and the two that only a visitor needs.
export const siteLinks = headerLinks.filter(({ path }) => !accountPaths.includes(path));
export const guestLinks = headerLinks.filter(({ path }) => accountPaths.includes(path));

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
      { path: "legal/subscription-and-billing-terms", label: "Subscription and Billing Terms" },
      { path: "legal/employer-terms", label: "Employer Terms" },
      { path: "legal/worker-terms", label: "Worker Terms" },
    ],
  },
];

export const footerLinks = footerGroups.flatMap(({ links }) => links);

// The slugs of the legal pages that the footer links to; the sitemap asks the database which of them are published.
export const legalSlugs = footerLinks.flatMap(({ path }) => (path.startsWith("legal/") ? [path.slice("legal/".length)] : []));
