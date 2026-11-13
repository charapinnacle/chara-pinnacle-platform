import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { PageContainer } from "@/components/layout/page-container";
import { Band } from "@/components/public/band";
import { ClosingCall } from "@/components/public/closing-call";
import { FactList } from "@/components/public/fact-list";
import { NumberedSteps } from "@/components/public/numbered-steps";
import { SectionHeading } from "@/components/public/section-heading";
import { daysText, oneTrialRule, trialConversion } from "@/lib/billing/presentation";
import { planCard, type PublicPlan } from "@/lib/billing/pricing";
import { getPostJobHref } from "@/lib/dal/organizations";
import { listPublicPlans } from "@/lib/dal/pricing";
import { getCurrentUser } from "@/lib/dal/session";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/employers">): Promise<Metadata> {
  return staticPageMetadata("employers", (await params).lang);
}

const steps = [
  {
    title: "Publish a vacancy",
    text: "Set the location, pay, conditions, accommodation and visa support, and say whether local or international candidates are welcome.",
  },
  {
    title: "Review applicants in one pipeline",
    text: "Move each applicant through the stages, add notes for your team and shortlist where your plan includes it.",
  },
  {
    title: "Hire and keep everyone informed",
    text: "The candidate follows every stage of the application on their own dashboard.",
  },
] as const;

// Only what the code enforces: invitations by role within the team size of the plan (FR-A5, FR-G1), two-step verification
// for owners and administrators before applicants, the team, the company profile and billing (FR-A4; vacancy pages are not
// gated, FR-A4 AC3), documents opened through time-limited links and logged for the candidate (FR-B5), and reports
// (FR-F4) with moderation that needs a written statement of reasons (FR-C7). The access log merges openings within
// seconds, so nothing here says "every opening".
const facts = [
  { title: "Your team, with roles", text: "Invite colleagues as administrators or members, up to the team size of your plan." },
  {
    title: "Two-step verification",
    text: "Owners and administrators confirm a second step before they open applicants, the team, the company profile or billing.",
  },
  {
    title: "Documents opened safely",
    text: "Candidate documents open through time-limited links, and the candidate sees which organisation opened them.",
  },
  { title: "Reporting and moderation", text: "Anyone can report a vacancy, and the Trust & Safety team can hide it with a written reason." },
] as const;

// The lowest price an employer can start with, read from the plan records like the pricing page (FR-H2): a plan whose price
// is on request is not a starting price. A failed read leaves the teaser to the link, so the page is still served; what
// Next.js throws to stop a render (a dynamic read during the build) is passed on.
async function startingPlan(): Promise<PublicPlan | null> {
  try {
    const plans = await listPublicPlans();
    return plans.filter((plan) => !plan.contactSales).sort((a, b) => a.priceMinor - b.priceMinor)[0] ?? null;
  } catch (error) {
    unstable_rethrow(error);
    console.error("The plans of the For employers page could not be loaded", error);
    return null;
  }
}

function PricingTeaser({ lang, plan }: { lang: string; plan: PublicPlan | null }) {
  const card = plan ? planCard(plan) : null;
  const trial = plan && plan.trialDays > 0 ? [`${daysText(plan.trialDays)} free trial.`, `${trialConversion(plan.name)} ${oneTrialRule}`] : [];
  return (
    <Band id="pricing" aria-labelledby="employers-pricing-heading" className="grid items-end gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:gap-12">
      <div className="grid gap-4">
        <h2 id="employers-pricing-heading" className="text-eyebrow text-brand-ink uppercase">
          Pricing
        </h2>
        {card?.price ? (
          <>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-section tabular-nums">{card.price}</span>
              <span className="text-body text-muted-foreground">{`${card.per}, excluding VAT`}</span>
            </p>
            <p className="max-w-[60ch] text-body text-pretty text-muted-foreground">
              {[`${card.name} plan.`, ...trial, "Higher plans are on the pricing page."].join(" ")}
            </p>
          </>
        ) : (
          <p className="text-body text-muted-foreground">The plans and their prices are on the pricing page.</p>
        )}
      </div>
      <LinkButton href={`/${lang}/pricing`} prefetch={false} variant="secondary" className="min-h-12 px-6">
        See all plans
      </LinkButton>
    </Band>
  );
}

// The employer's own page, as Indeed's is (OPEN_QUESTIONS.md D90): one promise and Post a Job, the three steps, what the
// product enforces, the starting price from the plan records, and a last call. Post a Job leads where the header's does.
export default async function EmployersPage({ params }: PageProps<"/[lang]/employers">) {
  const { lang } = await params;
  // A worker's account cannot hire, so the employer's page is not theirs (the header offers it only to the others).
  if ((await getCurrentUser())?.accountKind === "worker") redirect(`/${lang}`);
  const [postJobHref, plan] = await Promise.all([getPostJobHref(lang), startingPlan()]);
  return (
    <>
      <section aria-labelledby="employers-heading">
        <PageContainer className="grid justify-items-start gap-6 pt-20 pb-16 sm:pt-28 sm:pb-20 lg:pt-36 lg:pb-24">
          <p className="text-eyebrow text-brand-ink uppercase">For employers</p>
          <h1 id="employers-heading" className="max-w-[14ch] text-hero text-balance">
            Hire from the Global Workforce Network.
          </h1>
          <p className="max-w-[44ch] text-lead text-pretty text-muted-foreground">
            Publish a vacancy, review every applicant in one pipeline and keep candidates informed at each stage.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            {postJobHref ? (
              <LinkButton href={postJobHref} prefetch={false} className="min-h-12 px-6">
                Post a job
              </LinkButton>
            ) : null}
            <TextLink href="#pricing" standalone>
              See pricing
            </TextLink>
          </div>
        </PageContainer>
      </section>
      <Band aria-labelledby="employers-steps-heading" className="grid gap-12 sm:gap-16 lg:gap-20">
        <SectionHeading id="employers-steps-heading" eyebrow="How hiring works" title="From vacancy to hire in three steps." />
        <NumberedSteps steps={steps} />
      </Band>
      <Band aria-labelledby="employers-facts-heading" className="grid gap-12 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-5">
          <SectionHeading id="employers-facts-heading" eyebrow="What you get" title="Built for teams that hire together." />
        </div>
        <div className="lg:col-span-6 lg:col-start-7">
          <FactList label="What your organisation gets" facts={facts} />
        </div>
      </Band>
      <PricingTeaser lang={lang} plan={plan} />
      <ClosingCall id="employers-start-heading" title="Ready to hire?" primary={postJobHref ? { href: postJobHref, label: "Post a job" } : null} />
    </>
  );
}
