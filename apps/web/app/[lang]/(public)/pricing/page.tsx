import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { PlanCard } from "@/components/public/plan-card";
import { planCard, planLink, viewerNote } from "@/lib/billing/pricing";
import { getPricingViewer, listPublicPlans } from "@/lib/dal/pricing";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/pricing">): Promise<Metadata> {
  return staticPageMetadata("pricing", (await params).lang);
}

export default async function PricingPage({ params }: PageProps<"/[lang]/pricing">) {
  const { lang } = await params;
  const [plans, viewer] = await Promise.all([listPublicPlans(), getPricingViewer()]);
  const cards = plans.map(planCard);
  const note = viewerNote(viewer, lang);

  return (
    <ContentPage
      title="Pricing"
      lead="CHARA is free for workers. Employers use it under a subscription plan. All prices exclude VAT."
    >
      <ContentSection heading="Workers">
        <p>Workers never pay to create a profile, search vacancies or apply.</p>
      </ContentSection>
      <ContentSection heading="Employers">
        {note ? (
          <p>
            {note.text}
            {note.link ? (
              <>
                {" "}
                <TextLink href={note.link.href}>{note.link.label}</TextLink>
              </>
            ) : null}
          </p>
        ) : null}
        {cards.length > 0 ? (
          <ul aria-label="Employer plans" className="grid gap-4 sm:grid-cols-2">
            {cards.map((card) => (
              <PlanCard key={card.code} card={card} link={planLink(viewer, card, lang)} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Pricing is currently unavailable" description="Contact us for the current plans and prices.">
            <TextLink standalone href={`/${lang}/contact`}>
              Contact us
            </TextLink>
          </EmptyState>
        )}
        <p>A paid plan does not make an organisation verified or move its vacancies up in search results.</p>
        <p>
          The terms of a subscription are in the{" "}
          <TextLink href={`/${lang}/legal/subscription-and-billing-terms`}>Subscription and Billing Terms</TextLink>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
