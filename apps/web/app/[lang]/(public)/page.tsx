import type { Metadata } from "next";
import { ClosingCall } from "@/components/home/closing-call";
import { EmployerBand } from "@/components/home/employer-band";
import { Hero } from "@/components/home/hero";
import { HowItWorks } from "@/components/home/how-it-works";
import { PassportSection } from "@/components/home/passport-section";
import { StatisticsBlock } from "@/components/home/statistics-block";
import { BRAND_NAME } from "@/lib/brand";
import { getPostJobHref } from "@/lib/dal/organizations";
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
  const [tiles, postJobHref] = await Promise.all([getPlatformStatistics(), getPostJobHref(lang)]);
  return (
    <>
      <Hero lang={lang} />
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
