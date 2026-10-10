// The eight static public pages: the path after the language, the title and the description of each. The metadata of a
// page and the sitemap read this one list, so a page that is in the sitemap has the metadata it was listed with.
// Descriptions are 50 to 160 characters and differ from page to page (FR-H5 AC1).
export const staticPages = {
  home: {
    path: "",
    title: "CHARA — The Global Workforce Network",
    description:
      "CHARA brings workers and employers together: one profile, open vacancies and every application followed to the decision.",
  },
  jobs: {
    path: "jobs",
    title: "Find jobs — CHARA",
    description:
      "Search open vacancies from employers on CHARA by country, occupation, industry, salary, accommodation and visa support.",
  },
  pricing: {
    path: "pricing",
    title: "Pricing — CHARA",
    description:
      "CHARA is free for workers. See the subscription plans and prices for employers who publish vacancies and review applicants.",
  },
  howItWorks: {
    path: "how-it-works",
    title: "How CHARA Works — CHARA",
    description:
      "How workers and employers use CHARA, step by step: from the profile and the search to the application and the decision.",
  },
  trustSafety: {
    path: "trust-safety",
    title: "Trust & Safety — CHARA",
    description:
      "How CHARA treats vacancies, documents and complaints: private documents, moderated vacancies and public rules for everyone.",
  },
  about: {
    path: "about",
    title: "About — CHARA",
    description:
      "What CHARA is, what it does for workers and employers, and where to find the company that operates the platform.",
  },
  contact: {
    path: "contact",
    title: "Contact — CHARA",
    description:
      "How to reach CHARA, its privacy contact and its data-protection contact, and where to send a complaint about a vacancy.",
  },
  imprint: {
    path: "imprint",
    title: "Imprint — CHARA",
    description:
      "The legal details of the company that operates CHARA: its name, address, registration and contact details.",
  },
} as const satisfies Record<string, { path: string; title: string; description: string }>;

export type StaticPageKey = keyof typeof staticPages;
