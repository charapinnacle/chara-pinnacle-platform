import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { HeroSearch } from "@/components/home/hero-search";
import { StatisticsBlock } from "@/components/home/statistics-block";
import { Card } from "@/components/layout/card";
import { LinkButton } from "@/components/layout/link-button";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeading } from "@/components/public/section-heading";
import { StepList } from "@/components/public/step-list";
import { getPlatformStatistics } from "@/lib/dal/statistics";
import { employerSteps, workerSteps } from "@/lib/public/steps";
import { signUpPath } from "@/lib/routes";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  return staticPageMetadata("home", (await params).lang);
}

async function Statistics() {
  const tiles = await getPlatformStatistics();
  return tiles.length > 0 ? <StatisticsBlock tiles={tiles} /> : null;
}

// Only what exists today: the later phases of the client's structure (recruitment and staffing accounts, workforce
// requirements, matching) are not offered here (D81).
const audiences = [
  {
    id: "home-worker",
    heading: "Worker",
    bullets: [
      "Create your CHARA Passport",
      "Search jobs",
      "Apply",
      "Store skills and certificates",
      "Manage availability",
      "Track applications",
    ],
    kind: "worker",
    button: "I'm a worker",
  },
  {
    id: "home-employer",
    heading: "Employer",
    bullets: ["Post jobs", "Manage applicants", "Invite your team"],
    kind: "company",
    button: "I'm an employer",
  },
] as const;

function Hero({ lang }: { lang: string }) {
  return (
    <header className="mx-auto grid w-full max-w-3xl animate-rise justify-items-center gap-6 text-center">
      <h1 className="text-hero text-balance">The Global Workforce Network</h1>
      <p className="max-w-[40ch] text-lead text-balance text-muted-foreground">
        Connect with the people and companies that can build your workforce.
      </p>
      <div className="grid w-full gap-4 pt-2">
        <HeroSearch lang={lang} />
        <LinkButton href={signUpPath(lang, "company")} variant="secondary" className="justify-self-center">
          Post a Job
        </LinkButton>
      </div>
    </header>
  );
}

function WhoAreYou({ lang }: { lang: string }) {
  return (
    <section aria-labelledby="home-who-heading" className="grid gap-8">
      <SectionHeading id="home-who-heading" title="Who are you?" />
      <div className="grid gap-6 md:grid-cols-2">
        {audiences.map(({ id, heading, bullets, kind, button }) => (
          <Card key={id} as="section" aria-labelledby={id} padding="xl" className="content-between gap-8">
            <div className="grid content-start gap-4">
              <h3 id={id} className="text-h2">
                {heading}
              </h3>
              <ul className="grid list-disc gap-1.5 ps-5 text-body marker:text-brand">
                {bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </div>
            <LinkButton href={signUpPath(lang, kind)} variant="secondary" className="justify-self-start">
              {button}
            </LinkButton>
          </Card>
        ))}
      </div>
      <p className="text-small text-muted-foreground">Recruitment and staffing companies join in a later phase.</p>
    </section>
  );
}

function Passport({ lang }: { lang: string }) {
  return (
    <section aria-labelledby="home-passport-heading" className="grid gap-6 border-t pt-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-16">
      <div className="grid max-w-2xl gap-3">
        <h2 id="home-passport-heading" className="text-h1 text-balance">
          One professional profile. Multiple opportunities.
        </h2>
        <p className="text-lead text-pretty text-muted-foreground">
          Create your CHARA Passport once and use it for every application.
        </p>
      </div>
      <LinkButton href={signUpPath(lang, "worker")}>Create CHARA Passport</LinkButton>
    </section>
  );
}

function HowItWorks({ lang }: { lang: string }) {
  return (
    <section aria-labelledby="home-how-heading" className="grid gap-8">
      <SectionHeading id="home-how-heading" title="How CHARA works" />
      <div className="grid gap-10 md:grid-cols-2 md:gap-8">
        {[
          { id: "home-workers", heading: "For workers", steps: workerSteps },
          { id: "home-employers", heading: "For employers", steps: employerSteps },
        ].map(({ id, heading, steps }) => (
          <section key={id} aria-labelledby={id} className="grid content-start gap-4 border-t border-foreground/15 pt-6">
            <h3 id={id} className="text-h3">
              {heading}
            </h3>
            <StepList steps={steps} compact />
          </section>
        ))}
      </div>
      <TextLink standalone href={`/${lang}/how-it-works`}>
        How CHARA works in detail
      </TextLink>
    </section>
  );
}

function ClosingCall({ lang }: { lang: string }) {
  return (
    <section aria-labelledby="home-start-heading" className="grid justify-items-center gap-8 border-t pt-16 text-center">
      <h2 id="home-start-heading" className="text-h1 text-balance">
        Your Workforce. Your Network. One Platform.
      </h2>
      <div className="flex flex-wrap justify-center gap-3">
        <LinkButton href={signUpPath(lang, "worker")}>Join CHARA</LinkButton>
        <LinkButton href={signUpPath(lang, "company")} variant="secondary">
          Start hiring
        </LinkButton>
      </div>
    </section>
  );
}

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  return (
    <PageContainer layout="page" className="grid gap-16 sm:gap-24">
      <Hero lang={lang} />
      <WhoAreYou lang={lang} />
      <Passport lang={lang} />
      <HowItWorks lang={lang} />
      <Statistics />
      <ClosingCall lang={lang} />
    </PageContainer>
  );
}
