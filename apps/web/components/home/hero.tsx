import { HeroSearch } from "@/components/home/hero-search";
import { TextLink } from "@/components/forms/text-link";
import { PageContainer } from "@/components/layout/page-container";
import { EMPLOYERS_PATH } from "@/lib/public/navigation";

// The page is for the person looking for work, as Indeed's and Glassdoor's are: the client's headline and line, the search
// as the one action, and one quiet line that sends an employer to their own page.
export function Hero({ lang }: { lang: string }) {
  return (
    <section aria-labelledby="home-heading">
      <PageContainer className="grid justify-items-center pt-20 pb-16 text-center sm:pt-28 sm:pb-24 lg:pt-36 lg:pb-28">
        <h1 id="home-heading" className="max-w-[14ch] text-hero text-balance">
          The Global Workforce Network
        </h1>
        <p className="mt-6 max-w-[34ch] text-lead text-balance text-muted-foreground">
          Connect with the people and companies that can build your workforce.
        </p>
        <div className="mt-11 w-full max-w-4xl">
          <HeroSearch lang={lang} />
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-body text-muted-foreground">
          Hiring?
          <TextLink href={`/${lang}/${EMPLOYERS_PATH}`} prefetch={false} standalone>
            Post a job
          </TextLink>
        </p>
      </PageContainer>
    </section>
  );
}
