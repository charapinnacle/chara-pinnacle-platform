import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Bullets, PlanCard } from "@/components/public/plan-card";
import { planCard, planLink, RECOMMENDED_PLAN_CODE, viewerNote } from "@/lib/billing/pricing";
import { getPricingViewer, listPublicPlans } from "@/lib/dal/pricing";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/pricing">): Promise<Metadata> {
  return staticPageMetadata("pricing", (await params).lang);
}

function WorkersCard() {
  return (
    <section aria-labelledby="pricing-workers" className="grid gap-4 lg:row-span-2 lg:grid-rows-subgrid">
      <h2 id="pricing-workers" className="text-h2 lg:self-end">
        Workers
      </h2>
      <div className="flex flex-col justify-between gap-8 rounded-2xl bg-inverse p-card-xl text-inverse-muted shadow-card">
        <div className="grid gap-3">
          <p className="text-figure text-inverse-foreground">Always free</p>
          <p className="leading-7">Workers never pay to create a profile, search vacancies or apply.</p>
        </div>
        <Bullets items={["One profile and your documents", "Every open vacancy", "Your journey tracker"]} />
      </div>
    </section>
  );
}

export default async function PricingPage({ params }: PageProps<"/[lang]/pricing">) {
  const { lang } = await params;
  const [plans, viewer] = await Promise.all([listPublicPlans(), getPricingViewer()]);
  const cards = plans.map(planCard);
  const note = viewerNote(viewer, lang);

  return (
    <PageContainer layout="page" className="grid gap-12 sm:gap-16">
      <PageHeader
        size="display"
        title="Pricing"
        description="CHARA is free for workers. Employers use it under a subscription plan. All prices exclude VAT."
        className="max-w-3xl animate-rise"
      />
      <div className="grid gap-10 lg:grid-cols-3 lg:grid-rows-[auto_1fr] lg:gap-x-6 lg:gap-y-4">
        <WorkersCard />
        <section aria-labelledby="pricing-employers" className="grid gap-4 lg:col-span-2 lg:row-span-2 lg:grid-rows-subgrid">
          <div className="grid gap-1 lg:self-end">
            <h2 id="pricing-employers" className="text-h2">
              Employers
            </h2>
            {note ? (
              <p className="text-body text-muted-foreground">
                {note.text}
                {note.link ? (
                  <>
                    {" "}
                    <TextLink href={note.link.href}>{note.link.label}</TextLink>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          {cards.length > 0 ? (
            <ul aria-label="Employer plans" className="grid animate-stagger gap-6 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
              {cards.map((card) => (
                <PlanCard key={card.code} card={card} link={planLink(viewer, card, lang)} recommended={card.code === RECOMMENDED_PLAN_CODE} />
              ))}
            </ul>
          ) : (
            <EmptyState title="Pricing is currently unavailable" description="Contact us for the current plans and prices.">
              <TextLink standalone href={`/${lang}/contact`}>
                Contact us
              </TextLink>
            </EmptyState>
          )}
        </section>
      </div>
      <div className="grid gap-3 border-t pt-8 text-body leading-7 text-muted-foreground lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
        <h2 className="text-h2 text-foreground">Good to know</h2>
        <div className="grid max-w-[65ch] gap-3">
          <p>All prices exclude VAT.</p>
          <p>A paid plan does not make an organisation verified or move its vacancies up in search results.</p>
          <p>
            The terms of a subscription are in the{" "}
            <TextLink href={`/${lang}/legal/subscription-and-billing-terms`}>Subscription and Billing Terms</TextLink>.
          </p>
        </div>
      </div>
    </PageContainer>
  );
}
