import { HeroSearch } from "@/components/home/hero-search";
import { JourneyPreview } from "@/components/home/journey-preview";
import { LinkButton } from "@/components/layout/link-button";
import { signUpPath } from "@/lib/routes";

// The dark opening of the page. data-hero tells the header (see globals.css) that it lies over a dark surface; the h1 is
// the one place of the page where the gold gradient colours text.
export function Hero({ lang }: { lang: string }) {
  return (
    <header data-hero className="dark relative isolate overflow-hidden bg-background text-foreground">
      <div aria-hidden className="band-texture absolute inset-0 -z-10" />
      <div className="mx-auto grid w-full max-w-6xl gap-14 px-4 pt-32 pb-16 sm:px-6 sm:pt-40 sm:pb-24 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-16">
        <div className="grid animate-rise content-start gap-6">
          <h1 className="font-serif text-hero text-balance">
            The Global <span className="bg-brand-gradient bg-clip-text text-transparent">Workforce</span> Network
          </h1>
          <p className="max-w-[36ch] text-lead text-balance text-muted-foreground">
            Connect with the people and companies that can build your workforce.
          </p>
          <div className="grid max-w-xl gap-4 pt-2">
            <HeroSearch lang={lang} />
            <LinkButton href={signUpPath(lang, "company")} variant="secondary" className="lift justify-self-start bg-transparent hover:bg-secondary">
              Post a Job
            </LinkButton>
          </div>
        </div>
        <JourneyPreview />
      </div>
    </header>
  );
}
