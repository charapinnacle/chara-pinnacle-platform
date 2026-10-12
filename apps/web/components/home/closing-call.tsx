import { LinkButton } from "@/components/layout/link-button";
import { Photo } from "@/components/home/photo";
import { signUpPath } from "@/lib/routes";
import { BRAND_NAME } from "@/lib/brand";

// The construction photograph under a scrim that keeps the heading and the buttons at AA contrast or better.
export function ClosingCall({ lang }: { lang: string }) {
  return (
    <section aria-labelledby="home-start-heading" className="dark relative isolate overflow-hidden bg-inverse text-foreground">
      <Photo name="construction-team" sizes="100vw" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-inverse/75" />
      <div data-reveal className="mx-auto grid w-full max-w-6xl justify-items-center gap-10 px-4 py-24 text-center sm:px-6 sm:py-36">
        <h2 id="home-start-heading" className="max-w-4xl font-serif text-section text-balance">
          Your Workforce. Your Network. One Platform.
        </h2>
        <div className="flex flex-wrap justify-center gap-3">
          <LinkButton href={signUpPath(lang, "worker")} prefetch={false} className="lift">
            Join {BRAND_NAME}
          </LinkButton>
          <LinkButton href={signUpPath(lang, "company")} prefetch={false} variant="secondary" className="lift min-h-12 border-foreground/40 bg-transparent hover:bg-secondary">
            Post a Job
          </LinkButton>
        </div>
      </div>
    </section>
  );
}
