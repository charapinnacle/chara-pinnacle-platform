import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { NetworkView } from "@/components/corridors/network-view";
import { networkPath, parseNetworkSlug } from "@/lib/corridors/presentation";
import { getNetwork } from "@/lib/dal/corridors";
import { isReleased } from "@/lib/dal/release";
import { networkPageMetadata } from "@/lib/seo/metadata";

async function readNetwork(slug: string) {
  const address = parseNetworkSlug(slug);
  if (!address || !(await isReleased("release_corridors"))) return null;
  const network = await getNetwork(address.destination);
  return network ? { address, network } : null;
}

export async function generateMetadata({ params }: PageProps<"/[lang]/network/[destination]">): Promise<Metadata> {
  const { lang, destination } = await params;
  const read = await readNetwork(destination);
  return read ? networkPageMetadata(lang, read.network) : {};
}

// The network of one destination country (brief section 19) at /network/de; the upper-case spelling redirects there. A
// code that is not a country is not found, and so is every network while release_corridors is off.
export default async function NetworkPage({ params }: PageProps<"/[lang]/network/[destination]">) {
  const { lang, destination: slug } = await params;
  const read = await readNetwork(slug);
  if (!read) notFound();
  const { address, network } = read;
  if (!address.canonical) permanentRedirect(networkPath(lang, address.destination));
  const directories = await isReleased("release_partner_directories");
  return <NetworkView lang={lang} network={network} directories={directories} />;
}
