import Link from "next/link";
import { TextLink } from "@/components/forms/text-link";
import { HeroSearch } from "@/components/home/hero-search";
import { Photo } from "@/components/home/photo";
import { signUpPath } from "@/lib/routes";

export const HERO_PHOTO_SIZES = "100vw";

type HeroProps = { lang: string; popular: readonly { code: string; label: string }[] };

// data-hero tells the header (home.css) that it lies over a dark surface. The photograph is decoration under a scrim that
// keeps every text on it at AA contrast or better (home.css, hero-scrim).
export function Hero({ lang, popular }: HeroProps) {
  return (
    <header data-hero className="dark relative isolate overflow-hidden bg-inverse text-foreground">
      <Photo name="hero-welder" priority sizes={HERO_PHOTO_SIZES} className="object-[60%_center]" />
      <div aria-hidden className="hero-scrim absolute inset-0 -z-10" />
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pt-14 pb-16 sm:px-6 md:pt-44 md:pb-24 lg:pt-52 lg:pb-32">
        <div className="grid max-w-3xl animate-rise gap-5">
          <h1 className="font-serif text-hero text-balance">The Global Workforce Network</h1>
          <p className="max-w-[46ch] text-lead text-balance">Connect with the people and companies that can build your workforce.</p>
        </div>
        <div className="grid max-w-4xl gap-5">
          <HeroSearch lang={lang} />
          {popular.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p id="popular-searches" className="text-small font-medium">
                Popular searches
              </p>
              <ul aria-labelledby="popular-searches" className="flex flex-wrap gap-2">
                {popular.map(({ code, label }) => (
                  <li key={code}>
                    <Link
                      href={`/${lang}/jobs?occupation=${code}`}
                      prefetch={false}
                      className="inline-flex min-h-11 items-center rounded-full border border-foreground/30 bg-inverse/60 px-4 text-small font-medium backdrop-blur-sm transition-colors duration-150 hover:border-foreground/60 hover:bg-inverse/80 sm:min-h-9 sm:pointer-coarse:min-h-11"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="flex flex-wrap items-center gap-x-2 text-body">
            Hiring?
            <TextLink standalone href={signUpPath(lang, "company")} prefetch={false}>
              Post a Job
            </TextLink>
          </p>
        </div>
      </div>
    </header>
  );
}
