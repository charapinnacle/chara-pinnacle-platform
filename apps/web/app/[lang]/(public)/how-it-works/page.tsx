import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { StepList } from "@/components/public/step-list";
import { releasedSwitches } from "@/lib/dal/release";
import { getCurrentUser } from "@/lib/dal/session";
import { RECRUITMENT_DIRECTORY_PATH, STAFFING_DIRECTORY_PATH } from "@/lib/public/navigation";
import { partnerNetworkCopy as copy, partnerSteps } from "@/lib/public/partner-network";
import { employerSteps, workerSteps } from "@/lib/public/steps";
import { staticPageMetadata } from "@/lib/seo/metadata";
import { BRAND_NAME } from "@/lib/brand";

export async function generateMetadata({ params }: PageProps<"/[lang]/how-it-works">): Promise<Metadata> {
  return staticPageMetadata("howItWorks", (await params).lang);
}

// While release 2a is on the page explains the partner network too (FR-L5), to everyone but a signed-in worker, whose side
// of the site has no partner page; job orders are named without a link until their release is on.
export default async function HowItWorksPage({ params }: PageProps<"/[lang]/how-it-works">) {
  const [{ lang }, released, user] = await Promise.all([params, releasedSwitches(), getCurrentUser()]);
  const partners = released.includes("release_partner_directories") && user?.accountKind !== "worker";
  return (
    <ContentPage
      title={`How ${BRAND_NAME} works`}
      lead="One place where workers find vacancies and employers find applicants."
    >
      <ContentSection heading="For workers">
        <StepList steps={workerSteps} />
      </ContentSection>
      <ContentSection heading="For employers">
        <StepList steps={employerSteps} />
      </ContentSection>
      {partners ? (
        <ContentSection heading={copy.howItWorksHeading}>
          <StepList steps={partnerSteps} />
          <p>
            {copy.howItWorksDirectories}{" "}
            <TextLink href={`/${lang}/${RECRUITMENT_DIRECTORY_PATH}`}>{copy.recruitmentDirectory}</TextLink> and{" "}
            <TextLink href={`/${lang}/${STAFFING_DIRECTORY_PATH}`}>{copy.staffingDirectory}</TextLink>.
          </p>
          {released.includes("release_job_orders") ? null : <p className="text-muted-foreground">{copy.laterPhase}</p>}
        </ContentSection>
      ) : null}
    </ContentPage>
  );
}
