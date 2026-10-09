import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/public/content-page";

export const metadata: Metadata = {
  title: "How CHARA Works — CHARA",
  description: "How workers and employers use CHARA, step by step.",
};

const workerSteps = [
  "Create an account and fill in your profile: occupation, skills, languages, experience and documents.",
  "Search open vacancies by country, occupation, industry, salary and more.",
  "Apply to a vacancy and choose which of your documents the employer may see.",
  "Follow each application on your journey tracker until the employer has decided.",
];

const employerSteps = [
  "Register your organisation and invite your team.",
  "Publish a vacancy with its location, pay and conditions.",
  "Review the applicants, move them through the stages of your pipeline and shortlist the best.",
  "Choose a plan on the billing page of your organisation when you need more vacancies or team members.",
];

function Steps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="grid list-decimal gap-2 ps-6 marker:font-semibold">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

export default function HowItWorksPage() {
  return (
    <ContentPage
      title="How CHARA Works"
      lead="One place where workers find vacancies and employers find applicants."
    >
      <ContentSection heading="For workers">
        <Steps steps={workerSteps} />
      </ContentSection>
      <ContentSection heading="For employers">
        <Steps steps={employerSteps} />
      </ContentSection>
    </ContentPage>
  );
}
