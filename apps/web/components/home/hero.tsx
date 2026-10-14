import { HeroSearch } from "@/components/home/hero-search";
import { LinkButton } from "@/components/layout/link-button";
import { PageContainer } from "@/components/layout/page-container";

// The client's headline and line, the search and, for whom the header offers it, Post a Job: the two things a visitor can do
// at once.
export function Hero({ lang, postJobHref }: { lang: string; postJobHref: string | null }) {
  return (
    <section aria-labelledby="home-heading">
      <PageContainer className="grid gap-10 pt-16 pb-20 sm:gap-12 sm:pt-24 sm:pb-28 lg:pt-32">
        <div className="grid max-w-4xl animate-rise gap-6">
          <h1 id="home-heading" className="text-hero text-balance">
            The Global Workforce Network
          </h1>
          <p className="max-w-[44ch] text-lead text-balance text-muted-foreground">
            Connect with the people and companies that can build your workforce.
          </p>
        </div>
        <div className="grid max-w-4xl gap-5">
          <HeroSearch lang={lang} />
          {postJobHref ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body text-muted-foreground">
              Hiring?
              <LinkButton href={postJobHref} prefetch={false} variant="secondary">
                Post a Job
              </LinkButton>
            </p>
          ) : null}
        </div>
      </PageContainer>
    </section>
  );
}
