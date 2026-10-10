import type { Metadata } from "next";
import { Suspense } from "react";
import { TextLink } from "@/components/forms/text-link";
import { StatisticsBlock } from "@/components/home/statistics-block";
import { LinkButton } from "@/components/layout/link-button";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ContentSection } from "@/components/public/content-page";
import { getPlatformStatistics } from "@/lib/dal/statistics";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  return staticPageMetadata("home", (await params).lang);
}

async function Statistics() {
  const tiles = await getPlatformStatistics();
  return tiles.length > 0 ? <StatisticsBlock tiles={tiles} /> : null;
}

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  return (
    <PageContainer layout="page" className="grid max-w-4xl gap-12">
      <PageHeader size="display" title="The Global Workforce Network" className="gap-5">
        <p className="text-lead text-muted-foreground">Your Workforce. Your Network. One Platform.</p>
        <p className="max-w-[65ch] text-lead">
          CHARA brings workers and employers together. Workers keep one profile and apply to open vacancies. Employers
          publish vacancies and manage the applications they receive.
        </p>
        <div className="flex flex-wrap gap-3">
          <LinkButton href={`/${lang}/jobs`}>Browse vacancies</LinkButton>
          <LinkButton href={`/${lang}/signup`} variant="secondary">
            Create an account
          </LinkButton>
        </div>
      </PageHeader>
      <Suspense fallback={null}>
        <Statistics />
      </Suspense>
      <div className="grid gap-10 md:grid-cols-3">
        <ContentSection heading="For workers">
          <p>
            Build a profile with your occupation, skills, languages and documents. Apply to vacancies and follow each
            application from submission to the decision.
          </p>
        </ContentSection>
        <ContentSection heading="For employers">
          <p>
            Register your organisation, publish vacancies and review applicants in one pipeline together with your
            team.
          </p>
        </ContentSection>
        <ContentSection heading="Fair by design">
          <p>
            Paying for a plan does not make an organisation verified and does not move its vacancies up in search
            results.
          </p>
          <TextLink href={`/${lang}/trust-safety`}>Our safeguards</TextLink>
        </ContentSection>
      </div>
    </PageContainer>
  );
}
