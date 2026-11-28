import { HeroSearch, type HeroSearchProps } from "@/components/home/hero-search";
import { PageContainer } from "@/components/layout/page-container";

// The page is for the person looking for work, as Indeed's and Glassdoor's are: the client's headline and line, the search
// as the one action.
export function Hero(search: HeroSearchProps) {
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
          <HeroSearch {...search} />
        </div>
      </PageContainer>
    </section>
  );
}
