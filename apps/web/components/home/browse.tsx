import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Band } from "@/components/home/band";
import { Photo } from "@/components/home/photo";
import { formatCount } from "@/lib/i18n/format";
import { INDUSTRY_TILES } from "@/lib/public/home";
import { credibleCount } from "@/lib/statistics/tiles";
import { cn } from "@/lib/utils";

const chipClassName =
  "inline-flex min-h-11 items-center rounded-full border bg-card px-5 text-small font-medium transition-colors duration-150 hover:border-foreground/40 hover:bg-secondary";

type BrowseProps = {
  lang: string;
  industryCounts: Readonly<Record<string, number>> | null;
  countries: readonly { code: string; name: string }[];
};

// The tiles open Find Jobs filtered by the industry; a tile shows how many vacancies it holds only when the count is real
// and large enough to be credible (D87). The countries are those of the newest open vacancies (the sample of the latest
// jobs, not every country with a vacancy, D87), so a chip never leads to nothing.
export function Browse({ lang, industryCounts, countries }: BrowseProps) {
  return (
    <Band tone="white" aria-labelledby="home-industries-heading" className="grid gap-20">
      <div className="grid gap-10">
        <h2 id="home-industries-heading" className="font-serif text-section text-balance">
          Browse by industry
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {INDUSTRY_TILES.map(({ code, label, photo }) => {
            const count = credibleCount(industryCounts?.[code] ?? null);
            return (
              <li key={code}>
                <Link
                  href={`/${lang}/jobs?industry=${code}`}
                  prefetch={false}
                  className="dark group relative isolate flex aspect-square items-end justify-between gap-3 overflow-hidden rounded-card bg-inverse p-4 text-foreground sm:aspect-[4/3] sm:p-6"
                >
                  <Photo
                    name={photo}
                    sizes="(min-width: 72rem) 368px, (min-width: 64rem) 33vw, 50vw"
                    className="transition-transform duration-700 ease-(--ease-brand) motion-safe:group-hover:scale-[1.04]"
                  />
                  <span aria-hidden className="absolute inset-0 -z-10 bg-linear-to-t from-inverse/90 via-inverse/35 to-inverse/0" />
                  <span className="grid gap-1">
                    <span className="text-h2 leading-tight text-balance sm:text-xl">{label}</span>
                    {count === null ? null : <span className="text-small">{formatCount(count)} open jobs</span>}
                  </span>
                  <ArrowUpRight aria-hidden className="size-5 shrink-0 transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {countries.length > 0 ? (
        <section aria-labelledby="home-countries-heading" className="grid gap-8">
          <div className="grid gap-3">
            <h2 id="home-countries-heading" className="font-serif text-section text-balance">
              Browse by country
            </h2>
            <p className="text-lead text-muted-foreground">Where the newest vacancies are.</p>
          </div>
          <ul className="flex flex-wrap gap-2 sm:gap-3">
            {countries.map(({ code, name }) => (
              <li key={code}>
                <Link href={`/${lang}/jobs?country=${code}`} prefetch={false} className={chipClassName}>
                  {name}
                </Link>
              </li>
            ))}
            <li>
              <Link href={`/${lang}/jobs`} prefetch={false} className={cn(chipClassName, "border-primary bg-primary text-primary-foreground hover:bg-primary-hover")}>
                All countries
              </Link>
            </li>
          </ul>
        </section>
      ) : null}
    </Band>
  );
}
