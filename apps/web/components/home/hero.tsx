import Link from "next/link";
import { preload } from "react-dom";
import { TextLink } from "@/components/forms/text-link";
import { HeroSearch } from "@/components/home/hero-search";
import { Photo } from "@/components/home/photo";
import { photoSrcSet } from "@/lib/public/photos";

const PHOTO_SIZES = "100vw";

// The preload of the hero picture, with the same sources and sizes, so that the browser fetches the one file it will show.
// It must be called before the page waits for its data: a hint given later reaches the browser only after the head has
// been sent, as data for the client runtime instead of a link in the head.
export function preloadHeroPhoto() {
  preload("/images/home/hero-welder-1920.webp", {
    as: "image",
    type: "image/webp",
    imageSrcSet: photoSrcSet("hero-welder", "webp"),
    imageSizes: PHOTO_SIZES,
    fetchPriority: "high",
  });
}

type HeroProps = { lang: string; popular: readonly { code: string; label: string }[]; postJobHref: string | null };

// data-hero tells the header (home.css) that it lies over a dark surface. The photograph is decoration under a scrim that
// keeps every text on it at AA contrast or better (home.css, hero-scrim).
export function Hero({ lang, popular, postJobHref }: HeroProps) {
  return (
    <header data-hero className="dark relative isolate overflow-hidden bg-inverse text-foreground">
      <Photo name="hero-welder" priority sizes={PHOTO_SIZES} className="object-[60%_center]" />
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
          {postJobHref ? (
            <p className="flex flex-wrap items-center gap-x-2 text-body">
              Hiring?
              <TextLink standalone href={postJobHref} prefetch={false}>
                Post a Job
              </TextLink>
            </p>
          ) : null}
        </div>
      </div>
    </header>
  );
}
