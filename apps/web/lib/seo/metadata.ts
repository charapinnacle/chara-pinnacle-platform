import type { Metadata } from "next";
import type { PublicJob } from "@/lib/dal/hiring";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/i18n/format";
import { staticPages, type StaticPageKey } from "./pages";

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;
const VACANCY_DESCRIPTION_LENGTH = 155;

export function absoluteUrl(path: string): string {
  return new URL(path, env.NEXT_PUBLIC_SITE_URL).toString();
}

// Cuts at max UTF-16 units without leaving half of a surrogate pair at the end.
function cut(text: string, max: number): string {
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

function fitTitle(title: string): string {
  return title.length <= TITLE_MAX ? title : `${cut(title, TITLE_MAX - 1).trimEnd()}…`;
}

function fitDescription(description: string): string {
  return description.length <= DESCRIPTION_MAX ? description : `${cut(description, DESCRIPTION_MAX - 1).trimEnd()}…`;
}

// The canonical address has no query string: a search, a campaign tag and the page itself are one page to a crawler.
function pageMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: { title, description },
  };
}

export function staticPageMetadata(key: StaticPageKey, lang: string): Metadata {
  const { path, title, description } = staticPages[key];
  return pageMetadata(title, description, path ? `/${lang}/${path}` : `/${lang}`);
}

export function legalPageMetadata(
  lang: string,
  slug: string,
  document: { title: string; version: number; publishedAt: string },
): Metadata {
  return pageMetadata(
    fitTitle(`${document.title} — CHARA`),
    fitDescription(`Read the ${document.title} of CHARA: version ${document.version}, published ${formatDate(document.publishedAt)}.`),
    `/${lang}/legal/${slug}`,
  );
}

// The description is the beginning of the text of the vacancy with its line breaks and runs of spaces made single
// spaces, and nothing added to it.
export function vacancyMetadata(lang: string, job: Pick<PublicJob, "id" | "title" | "description" | "employer">): Metadata {
  const description = cut(job.description.replace(/\s+/g, " ").trim(), VACANCY_DESCRIPTION_LENGTH).trimEnd();
  return pageMetadata(fitTitle(`${job.title} - ${job.employer.displayName} | CHARA`), description, `/${lang}/jobs/${job.id}`);
}
