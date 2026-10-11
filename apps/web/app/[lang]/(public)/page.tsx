import type { Metadata } from "next";
import { ClosingCall } from "@/components/home/closing-call";
import { Hero } from "@/components/home/hero";
import { HowItWorks } from "@/components/home/how-it-works";
import { PassportSection } from "@/components/home/passport-section";
import { RevealOnScroll } from "@/components/home/reveal-on-scroll";
import { StatisticsBlock } from "@/components/home/statistics-block";
import { TrustStrip } from "@/components/home/trust-strip";
import { WhoAreYou } from "@/components/home/who-are-you";
import { getPlatformStatistics } from "@/lib/dal/statistics";
import { newsreader } from "@/lib/display-font";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  return staticPageMetadata("home", (await params).lang);
}

async function Statistics() {
  const tiles = await getPlatformStatistics();
  return tiles.length > 0 ? <StatisticsBlock tiles={tiles} /> : null;
}

// The serif is attached to this page alone (its class sets the variable for the page below it), so no other page loads it.
export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  return (
    <div className={newsreader.variable}>
      <Hero lang={lang} />
      <TrustStrip />
      <WhoAreYou lang={lang} />
      <PassportSection lang={lang} />
      <HowItWorks lang={lang} />
      <Statistics />
      <ClosingCall lang={lang} />
      <RevealOnScroll />
    </div>
  );
}
