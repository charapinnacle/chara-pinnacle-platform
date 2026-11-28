import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { CorridorView } from "@/components/corridors/corridor-view";
import { corridorPath, parseCorridorSlug } from "@/lib/corridors/presentation";
import { getCorridor } from "@/lib/dal/corridors";
import { isReleased } from "@/lib/dal/release";
import { corridorPageMetadata } from "@/lib/seo/metadata";

async function readCorridor(slug: string) {
  const address = parseCorridorSlug(slug);
  if (!address || !(await isReleased("release_corridors"))) return null;
  const corridor = await getCorridor(address.source, address.destination);
  return corridor ? { address, corridor } : null;
}

export async function generateMetadata({ params }: PageProps<"/[lang]/corridors/[corridor]">): Promise<Metadata> {
  const { lang, corridor } = await params;
  const read = await readCorridor(corridor);
  return read ? corridorPageMetadata(lang, read.corridor) : {};
}

// One corridor (brief section 18) at /corridors/ph-de; the upper-case spelling redirects there. A corridor with fewer
// partners than the threshold is not listed, but its page answers in the suppressed form so that a link never breaks.
// Codes that are not two different countries are not found, and so is every corridor while release_corridors is off.
export default async function CorridorPage({ params }: PageProps<"/[lang]/corridors/[corridor]">) {
  const { lang, corridor: slug } = await params;
  const read = await readCorridor(slug);
  if (!read) notFound();
  const { address, corridor } = read;
  if (!address.canonical) permanentRedirect(corridorPath(lang, address.source, address.destination));
  const directories = await isReleased("release_partner_directories");
  return <CorridorView lang={lang} corridor={corridor} directories={directories} />;
}
