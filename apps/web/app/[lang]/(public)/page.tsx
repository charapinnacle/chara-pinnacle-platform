import { ArrowRight, LockKeyhole, Scale, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { TextLink } from "@/components/forms/text-link";
import { HeroSearch } from "@/components/home/hero-search";
import { StatisticsBlock } from "@/components/home/statistics-block";
import { BrandMark } from "@/components/layout/brand";
import { LinkButton } from "@/components/layout/link-button";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeading } from "@/components/public/section-heading";
import { StepList } from "@/components/public/step-list";
import { getPlatformStatistics } from "@/lib/dal/statistics";
import { employerSteps, workerSteps } from "@/lib/public/steps";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  return staticPageMetadata("home", (await params).lang);
}

async function Statistics() {
  const tiles = await getPlatformStatistics();
  return tiles.length > 0 ? <StatisticsBlock tiles={tiles} /> : null;
}

const safeguards = [
  {
    icon: Scale,
    title: "Fair by design",
    text: "Paying for a plan does not make an organisation verified and does not move its vacancies up in search results.",
  },
  {
    icon: LockKeyhole,
    title: "Private by default",
    text: "Your documents stay private until you share them with an application. CHARA staff cannot open them.",
  },
  {
    icon: ShieldCheck,
    title: "Moderated vacancies",
    text: "A vacancy that breaks our rules can be hidden from the public pages, and the rules are public.",
  },
] as const;

function Hero({ lang }: { lang: string }) {
  return (
    <header className="grid animate-rise gap-8">
      <p className="inline-flex items-center gap-2 justify-self-start rounded-full border bg-card px-3 py-1 text-small text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-brand" />
        Workers never pay
      </p>
      <div className="grid max-w-4xl gap-5">
        <h1 className="text-hero text-balance">The Global Workforce Network</h1>
        <p className="text-lead text-muted-foreground">Your Workforce. Your Network. One Platform.</p>
        <p className="max-w-[60ch] text-lead text-pretty">
          CHARA brings workers and employers together. Workers keep one profile and apply to open vacancies. Employers
          publish vacancies and manage the applications they receive.
        </p>
      </div>
      <div className="grid max-w-4xl gap-4">
        <HeroSearch lang={lang} />
        <div className="flex flex-wrap gap-3">
          <LinkButton href={`/${lang}/jobs`} variant="secondary" className="group">
            Browse vacancies
            <ArrowRight aria-hidden className="size-4 transition-transform duration-200 ease-brand group-hover:translate-x-0.5" />
          </LinkButton>
          <LinkButton href={`/${lang}/signup`} variant="secondary">
            Create an account
          </LinkButton>
        </div>
      </div>
    </header>
  );
}

function HowItWorks({ lang }: { lang: string }) {
  return (
    <section aria-labelledby="home-how-heading" className="grid gap-10">
      <SectionHeading
        id="home-how-heading"
        eyebrow="How CHARA works"
        title="Four steps on each side"
        description="One place where workers find vacancies and employers find applicants."
      />
      <div className="grid gap-10 md:grid-cols-2 md:gap-8">
        {[
          { id: "home-workers", heading: "For workers", steps: workerSteps },
          { id: "home-employers", heading: "For employers", steps: employerSteps },
        ].map(({ id, heading, steps }) => (
          <section key={id} aria-labelledby={id} className="grid content-start gap-6 rounded-2xl border bg-card p-card-xl sm:p-card-2xl">
            <h3 id={id} className="text-h2">
              {heading}
            </h3>
            <StepList steps={steps} titleAs="h4" />
          </section>
        ))}
      </div>
      <TextLink standalone href={`/${lang}/how-it-works`}>
        How CHARA works in detail
      </TextLink>
    </section>
  );
}

function Safeguards({ lang }: { lang: string }) {
  return (
    <section aria-labelledby="home-trust-heading" className="grid gap-10">
      <SectionHeading id="home-trust-heading" eyebrow="Trust & Safety" title="Built on rules you can read" />
      <ul className="grid animate-stagger gap-8 md:grid-cols-3">
        {safeguards.map(({ icon: Icon, title, text }) => (
          <li key={title} className="grid content-start gap-3 border-t border-foreground/15 pt-6">
            <Icon aria-hidden className="size-5 text-brand-ink" strokeWidth={1.75} />
            <h3 className="text-h3">{title}</h3>
            <p className="text-body leading-7 text-muted-foreground">{text}</p>
          </li>
        ))}
      </ul>
      <TextLink standalone href={`/${lang}/trust-safety`}>
        Our safeguards
      </TextLink>
    </section>
  );
}

function ClosingCall({ lang }: { lang: string }) {
  return (
    <section
      aria-labelledby="home-start-heading"
      className="grid gap-8 rounded-2xl bg-inverse p-card-xl text-inverse-muted sm:p-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"
    >
      <div className="grid gap-6">
        <BrandMark size="lg" />
        <SectionHeading
          id="home-start-heading"
          tone="inverse"
          title="Your next job or your next hire starts here."
          description="Workers never pay to create a profile, search or apply. Employers find the plans on the pricing page."
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <LinkButton href={`/${lang}/signup`} className="bg-brand-gradient text-inverse transition-opacity duration-150 hover:opacity-90">
          Create your account
        </LinkButton>
        <LinkButton
          href={`/${lang}/pricing`}
          variant="secondary"
          className="border-inverse-muted/40 bg-transparent text-inverse-foreground hover:bg-inverse-foreground/10"
        >
          See pricing
        </LinkButton>
      </div>
    </section>
  );
}

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  return (
    <PageContainer layout="page" className="grid gap-20 sm:gap-28">
      <Hero lang={lang} />
      <Suspense fallback={null}>
        <Statistics />
      </Suspense>
      <HowItWorks lang={lang} />
      <Safeguards lang={lang} />
      <ClosingCall lang={lang} />
    </PageContainer>
  );
}
