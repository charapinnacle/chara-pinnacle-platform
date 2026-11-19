import type { Step } from "@/lib/public/steps";

// What the home, How it works and For employers pages say about the partner network while release 2a is on (FR-L5):
// plain statements of what the release delivers, until the owner approves texts of their own. No string holds a number
// (AC8): a figure on these pages comes only from the database (public.v_platform_counts, billing.plans).
export const partnerNetworkCopy = {
  homeHeading: "For recruitment and staffing companies",
  homeText: "List your company in the partner directories, where employers look for recruitment and staffing partners.",
  employersEyebrow: "Partner network",
  employersHeading: "Find recruitment and staffing partners.",
  employersText:
    "Search the directories of recruitment companies and staffing companies by country, occupation, industry and language. Results are ordered by the filters they match; no company pays to rank higher.",
  howItWorksHeading: "For recruitment and staffing companies",
  howItWorksDirectories: "Employers find listed companies in the partner directories:",
  laterPhase: "Workforce requirements and job orders come in a later phase.",
  howItWorksJobOrders: "Employers publish workforce requirements, and listed companies find them as",
  jobOrdersLink: "job orders",
  recruitmentSignUp: "Sign up as a recruitment company",
  staffingSignUp: "Sign up as a staffing company",
  recruitmentDirectory: "Recruitment partners",
  staffingDirectory: "Staffing partners",
} as const;

export const partnerSteps: readonly Step[] = [
  { title: "Register", text: "Create a company account as a recruitment company or a staffing company." },
  {
    title: "Describe your company",
    text: "Add your company details, the countries you serve and the occupations and industries you work in.",
  },
  {
    title: "Get listed",
    text: "After a review of your company details, your profile appears in the partner directories that employers search.",
  },
];
