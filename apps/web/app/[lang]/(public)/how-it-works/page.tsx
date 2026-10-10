import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { StepList } from "@/components/public/step-list";
import { employerSteps, workerSteps } from "@/lib/public/steps";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/how-it-works">): Promise<Metadata> {
  return staticPageMetadata("howItWorks", (await params).lang);
}

export default function HowItWorksPage() {
  return (
    <ContentPage
      title="How CHARA Works"
      lead="One place where workers find vacancies and employers find applicants."
    >
      <ContentSection heading="For workers">
        <StepList steps={workerSteps} />
      </ContentSection>
      <ContentSection heading="For employers">
        <StepList steps={employerSteps} />
      </ContentSection>
    </ContentPage>
  );
}
