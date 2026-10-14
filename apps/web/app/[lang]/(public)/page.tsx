import type { Metadata } from "next";
import { ClosingCall } from "@/components/home/closing-call";
import { Hero } from "@/components/home/hero";
import { Network } from "@/components/home/network";
import { PassportSection } from "@/components/home/passport-section";
import { StatisticsBlock } from "@/components/home/statistics-block";
import { WhoAreYou } from "@/components/home/who-are-you";
import { getPostJobHref } from "@/lib/dal/organizations";
import { getPlatformStatistics } from "@/lib/dal/statistics";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  return staticPageMetadata("home", (await params).lang);
}

// The order of the client's structure within Phase 1 (OPEN_QUESTIONS.md D88): the network story, then the live figures when
// they are credible, then the closing call. Nothing on the page is a vacancy list: the search leads to them.
export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  const [tiles, postJobHref] = await Promise.all([getPlatformStatistics(), getPostJobHref(lang)]);
  return (
    <>
      <Hero lang={lang} postJobHref={postJobHref} />
      <WhoAreYou lang={lang} />
      <Network lang={lang} now={new Date()} />
      <PassportSection lang={lang} />
      {tiles.length > 0 ? <StatisticsBlock tiles={tiles} /> : null}
      <ClosingCall lang={lang} postJobHref={postJobHref} />
    </>
  );
}
