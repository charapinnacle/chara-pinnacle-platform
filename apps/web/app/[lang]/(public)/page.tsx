import Link from "next/link";
import { TextLink } from "@/components/forms/text-link";
import { PageContainer } from "@/components/layout/page-container";
import { ContentSection } from "@/components/public/content-page";

const buttonClassName =
  "inline-flex min-h-11 items-center rounded-lg px-6 text-base font-semibold";

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  return (
    <PageContainer layout="page" className="grid max-w-4xl gap-12">
      <header className="grid gap-5">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl sm:leading-tight">
          The Global Workforce Network
        </h1>
        <p className="text-xl text-muted-foreground">Your Workforce. Your Network. One Platform.</p>
        <p className="max-w-[65ch] text-lg leading-8">
          CHARA brings workers and employers together. Workers keep one profile and apply to open vacancies. Employers
          publish vacancies and manage the applications they receive.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/${lang}/jobs`}
            className={`${buttonClassName} bg-primary text-primary-foreground hover:bg-primary-hover`}
          >
            Browse vacancies
          </Link>
          <Link
            href={`/${lang}/signup`}
            className={`${buttonClassName} border border-input bg-card text-secondary-foreground hover:bg-secondary`}
          >
            Create an account
          </Link>
        </div>
      </header>
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
