import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TextLink } from "@/components/forms/text-link";
import { PartnerCards } from "@/components/home/partner-band";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { StepList } from "@/components/public/step-list";
import { isReleased } from "@/lib/dal/release";
import { RECRUITMENT_DIRECTORY_PATH, STAFFING_DIRECTORY_PATH } from "@/lib/public/navigation";
import { partnerNetworkCopy as copy, partnerSteps } from "@/lib/public/partner-network";
import { forPartnersPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/for-partners">): Promise<Metadata> {
  const { lang } = await params;
  return (await isReleased("release_partner_directories")) ? forPartnersPageMetadata(lang) : {};
}

// The door of the header for recruitment and staffing companies (FR-L5): how a company gets listed, the sign-up as either
// type and the directories employers search. It exists only while release 2a is on.
export default async function ForPartnersPage({ params }: PageProps<"/[lang]/for-partners">) {
  const { lang } = await params;
  if (!(await isReleased("release_partner_directories"))) notFound();
  return (
    <ContentPage title={copy.forPartnersTitle} lead={copy.forPartnersLead}>
      <ContentSection heading="How it works">
        <StepList steps={partnerSteps} />
        <p>
          {copy.howItWorksDirectories}{" "}
          <TextLink href={`/${lang}/${RECRUITMENT_DIRECTORY_PATH}`}>{copy.recruitmentDirectory}</TextLink> and{" "}
          <TextLink href={`/${lang}/${STAFFING_DIRECTORY_PATH}`}>{copy.staffingDirectory}</TextLink>.
        </p>
      </ContentSection>
      <section aria-labelledby="for-partners-start-heading" className="grid gap-6 border-t pt-8">
        <h2 id="for-partners-start-heading" className="text-h2">
          Get started
        </h2>
        <PartnerCards lang={lang} />
      </section>
    </ContentPage>
  );
}
