import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { ContentPage, ContentSection } from "@/components/public/content-page";

export const metadata: Metadata = {
  title: "Pricing — CHARA",
  description: "What CHARA costs for workers and employers.",
};

export default async function PricingPage({ params }: PageProps<"/[lang]/pricing">) {
  const { lang } = await params;
  return (
    <ContentPage title="Pricing" lead="CHARA is free for workers. Employers use it under a subscription plan.">
      <ContentSection heading="Workers">
        <p>Workers never pay to create a profile, search vacancies or apply.</p>
      </ContentSection>
      <ContentSection heading="Employers">
        <p>
          Prices are shown in euros and exclude VAT. The terms of a subscription are in the{" "}
          <TextLink href={`/${lang}/legal/subscription-and-billing-terms`}>Subscription and Billing Terms</TextLink>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
