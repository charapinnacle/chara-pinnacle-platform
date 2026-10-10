// The steps of How CHARA Works, shown in full on that page and on the home page: one source, so the two never differ.
export type Step = { title: string; text: string };

export const workerSteps: readonly Step[] = [
  {
    title: "Create your profile",
    text: "Create an account and fill in your profile: occupation, skills, languages, experience and documents.",
  },
  { title: "Search vacancies", text: "Search open vacancies by country, occupation, industry, salary and more." },
  { title: "Apply", text: "Apply to a vacancy and choose which of your documents the employer may see." },
  { title: "Follow your application", text: "Follow each application on your journey tracker until the employer has decided." },
];

export const employerSteps: readonly Step[] = [
  { title: "Register", text: "Register your organisation and invite your team." },
  { title: "Publish", text: "Publish a vacancy with its location, pay and conditions." },
  {
    title: "Review applicants",
    text: "Review the applicants, move them through the stages of your pipeline and shortlist the best.",
  },
  {
    title: "Choose a plan",
    text: "Choose a plan on the billing page of your organisation when you need more vacancies or team members.",
  },
];
