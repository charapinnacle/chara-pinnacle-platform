import type { Metadata } from "next";
import "@/components/home/home.css";
import { Browse } from "@/components/home/browse";
import { ClosingCall } from "@/components/home/closing-call";
import { Hero, HERO_PHOTO_SIZES } from "@/components/home/hero";
import { preloadPhoto } from "@/components/home/photo";
import { LatestJobs } from "@/components/home/latest-jobs";
import { ProductPanels } from "@/components/home/product-panels";
import { ReachBand } from "@/components/home/reach-band";
import { RevealOnScroll } from "@/components/home/reveal-on-scroll";
import { TrustStrip } from "@/components/home/trust-strip";
import { getIndustryCounts, getNewestJobs } from "@/lib/dal/home";
import { getCountries, getIndustries, getLanguages, getOccupations } from "@/lib/dal/reference";
import { getPlatformStatistics } from "@/lib/dal/statistics";
import { newsreader } from "@/lib/display-font";
import { COUNTRY_CHIP_LIMIT, countryChips, INDUSTRY_TILES, popularSearches, reachFigures } from "@/lib/public/home";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  return staticPageMetadata("home", (await params).lang);
}

// Every read is cached for all visitors (the reference lists for hours, the vacancies for a minute) except the
// statistics view, which is one row. The serif is attached to this page alone (its class sets the variable for the page
// below it), so no other page loads it.
export default async function Home({ params }: PageProps<"/[lang]">) {
  preloadPhoto("hero-welder", HERO_PHOTO_SIZES);
  const { lang } = await params;
  const [jobs, industryCounts, tiles, occupations, countries, industries, languages] = await Promise.all([
    getNewestJobs(),
    getIndustryCounts(INDUSTRY_TILES.map(({ code }) => code)),
    getPlatformStatistics(),
    getOccupations(),
    getCountries(),
    getIndustries(),
    getLanguages(),
  ]);
  const countryNames = new Map(countries.map(({ code, name }) => [code, name]));
  const figures = reachFigures({
    countries: countries.length,
    occupations: occupations.length,
    industries: industries.length,
    languages: languages.length,
  });

  return (
    <div className={newsreader.variable}>
      <Hero lang={lang} popular={popularSearches(occupations)} />
      {jobs ? <LatestJobs lang={lang} jobs={jobs} countryNames={countryNames} /> : null}
      <Browse lang={lang} industryCounts={industryCounts} countries={jobs ? countryChips(jobs, countries, COUNTRY_CHIP_LIMIT) : []} />
      <ProductPanels lang={lang} />
      <ReachBand figures={figures} tiles={tiles} />
      <TrustStrip lang={lang} />
      <ClosingCall lang={lang} />
      <RevealOnScroll />
    </div>
  );
}
