import type { Metadata } from "next";
import { ClosingCall } from "@/components/public/closing-call";
import { EmployerBand } from "@/components/home/employer-band";
import { Hero } from "@/components/home/hero";
import { HowItWorks } from "@/components/home/how-it-works";
import { PassportSection } from "@/components/home/passport-section";
import { StatisticsBlock } from "@/components/home/statistics-block";
import { BRAND_NAME } from "@/lib/brand";
import { getSearchSuggestions } from "@/lib/dal/hiring";
import { getPostJobHref } from "@/lib/dal/organizations";
import { getCountries, getOccupations } from "@/lib/dal/reference";
import { getPlatformStatistics } from "@/lib/dal/statistics";
import { signUpPath } from "@/lib/routes";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  return staticPageMetadata("home", (await params).lang);
}

// One audience and one job, as Indeed's and Glassdoor's home pages have (OPEN_QUESTIONS.md D90): the search for the person
// looking for work, how it works, the passport, one line for employers, the live figures when they are credible, and the
// closing call. The employer's story is the For employers page.
export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  const [tiles, postJobHref, suggestions, countries, occupations] = await Promise.all([
    getPlatformStatistics(),
    getPostJobHref(lang),
    getSearchSuggestions(),
    getCountries(),
    getOccupations(),
  ]);
  // Vacancy titles come before the occupations, and an occupation is offered by its name without the ISCO code.
  const what = [
    ...suggestions.titles.map((title) => ({ value: `title:${title}`, label: title })),
    ...occupations.map((occupation) => ({ value: `isco:${occupation.code}`, label: occupation.label, keywords: occupation.synonyms.join(" ") })),
  ];
  return (
    <>
      <Hero
        lang={lang}
        what={what}
        countries={countries.map((country) => ({ value: country.code, label: country.name }))}
        citiesByCountry={suggestions.citiesByCountry}
      />
      <HowItWorks lang={lang} />
      <PassportSection />
      <EmployerBand lang={lang} postJobHref={postJobHref} />
      {tiles.length > 0 ? <StatisticsBlock tiles={tiles} /> : null}
      <ClosingCall
        id="home-start-heading"
        title="Your Workforce. Your Network. One Platform."
        primary={{ href: signUpPath(lang), label: `Join ${BRAND_NAME}` }}
        secondary={postJobHref ? { href: postJobHref, label: "Start hiring" } : null}
      />
    </>
  );
}
