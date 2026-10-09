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

// The Imprint and the legal pages of Phase 1. Whether a legal page exists is decided by the database (a published version
// of its slug), not by this list: the list only says which of them the footer links to.
export const footerLinks = [
  { path: "imprint", label: "Imprint" },
  { path: "legal/terms-of-service", label: "Terms of Service" },
  { path: "legal/privacy-policy", label: "Privacy Policy" },
  { path: "legal/cookie-policy", label: "Cookie Policy" },
  { path: "legal/platform-rules", label: "Platform Rules" },
  { path: "legal/acceptable-use-policy", label: "Acceptable Use Policy" },
  { path: "legal/subscription-and-billing-terms", label: "Subscription and Billing Terms" },
  { path: "legal/employer-terms", label: "Employer Terms" },
  { path: "legal/worker-terms", label: "Worker Terms" },
  { path: "legal/complaints-and-dispute-process", label: "Complaints and Dispute Process" },
  { path: "legal/account-suspension-and-termination-rules", label: "Account Suspension and Termination Rules" },
] as const;
