import type { Metadata } from "next";
import { partnerTypeLabels } from "@/components/forms/account-kind-options";
import { BRAND_NAME } from "@/lib/brand";
import type { PublicJob } from "@/lib/dal/hiring";
import type { CompanyPage } from "@/lib/companies/page";
import { env } from "@/lib/env";
import { countryInSentence, formatDate } from "@/lib/i18n/format";
import type { PartnerProfile } from "@/lib/partners/profile";
import { JOB_ORDERS_PATH, RANKING_PATH } from "@/lib/public/navigation";
import { companyPagePath, partnerProfilePath } from "@/lib/routes";
import { staticPages, type StaticPageKey } from "./pages";

const TITLE_MAX = 60;
const PARTNER_TITLE_MAX = 70;
const DESCRIPTION_MAX = 160;
const VACANCY_DESCRIPTION_LENGTH = 155;

function absoluteUrl(path: string): string {
  return new URL(path, env.NEXT_PUBLIC_SITE_URL).toString();
}

// Cuts at max UTF-16 units without leaving half of a surrogate pair at the end.
function cut(text: string, max: number): string {
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

function fit(text: string, max: number): string {
  return text.length <= max ? text : `${cut(text, max - 1).trimEnd()}…`;
}

// The product name is added only when it fits whole: a title that is cut keeps what names the page, never "Chara Pin…".
function withBrand(title: string, separator: string): string {
  const full = `${title}${separator}${BRAND_NAME}`;
  return full.length <= TITLE_MAX ? full : fit(title, TITLE_MAX);
}

// The canonical address has no query string: a search, a campaign tag and the page itself are one page to a crawler.
// The image of app/opengraph-image.tsx and the site name are named again because a page's openGraph replaces the
// inherited one whole. The title already holds the product name, so it is absolute: the layout's template is not added.
function pageMetadata(title: string, description: string, path: string): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: { title, description, siteName: BRAND_NAME, images: "/opengraph-image" },
  };
}

export function staticPageMetadata(key: StaticPageKey, lang: string): Metadata {
  const { path, title, description } = staticPages[key];
  return pageMetadata(title, description, path ? `/${lang}/${path}` : `/${lang}`);
}

export function legalIndexMetadata(lang: string): Metadata {
  return pageMetadata(
    `All legal documents — ${BRAND_NAME}`,
    `The current version of every ${BRAND_NAME} legal document, the terms, the privacy policy and the rules, with the date it was published.`,
    `/${lang}/legal`,
  );
}

export function legalPageMetadata(
  lang: string,
  slug: string,
  document: { title: string; version: number; publishedAt: string },
): Metadata {
  return pageMetadata(
    withBrand(document.title, " — "),
    fit(`Read the ${document.title} of ${BRAND_NAME}: version ${document.version}, published ${formatDate(document.publishedAt)}.`, DESCRIPTION_MAX),
    `/${lang}/legal/${slug}`,
  );
}

// The description is the beginning of the text of the vacancy with its line breaks and runs of spaces made single
// spaces, and nothing added to it.
export function vacancyMetadata(lang: string, job: Pick<PublicJob, "id" | "title" | "description" | "employer">): Metadata {
  const description = cut(job.description.replace(/\s+/g, " ").trim(), VACANCY_DESCRIPTION_LENGTH).trimEnd();
  return pageMetadata(withBrand(`${job.title} - ${job.employer.displayName}`, " | "), description, `/${lang}/jobs/${job.id}`);
}

// A directory has one canonical address: its filtered and paged addresses are the same page to a crawler.
export function partnerDirectoryMetadata(lang: string): Metadata {
  return pageMetadata(
    withBrand("Find recruitment partners", " — "),
    `Search recruitment companies on ${BRAND_NAME} by destination, occupation, source country, industry, language and recruitment type.`,
    `/${lang}/partners/recruitment`,
  );
}

export function staffingDirectoryMetadata(lang: string): Metadata {
  return pageMetadata(
    withBrand("Find staffing partners", " — "),
    `Search staffing companies on ${BRAND_NAME} by market served, occupation, operating country, industry, staffing type and workforce size.`,
    `/${lang}/partners/staffing`,
  );
}

// The public page about job orders (FR-L5); the job orders themselves are behind sign-in and never in a tag (NFR-S11).
export function jobOrdersPageMetadata(lang: string): Metadata {
  return pageMetadata(
    withBrand("Job orders", " — "),
    `How employers publish workforce requirements on ${BRAND_NAME} as job orders for recruitment and staffing companies, and who sees them.`,
    `/${lang}/${JOB_ORDERS_PATH}`,
  );
}

export function rankingPageMetadata(lang: string): Metadata {
  return pageMetadata(
    withBrand("How search results are ranked", " — "),
    `The parameters that decide the order of the recruitment and staffing partners in the searches of ${BRAND_NAME}, and what never does.`,
    `/${lang}/${RANKING_PATH}`,
  );
}

const countries = (items: readonly { code: string; name: string }[]) =>
  items.map((item) => countryInSentence(item.code, item.name)).join(", ");

// The title names the company, its type and its country, then the product (FR-K4 AC7 gives it whole, so the product name
// is kept even past the 60 characters of the other titles; the part before it is cut at 70). The description is the
// beginning of the partner's own text, or, without one, a sentence made of its own fields; no figure of the platform and
// no word of verification.
export function partnerProfileMetadata(
  lang: string,
  profile: Pick<PartnerProfile, "slug" | "displayName" | "type" | "basedIn" | "description" | "sourceCountries" | "servedCountries">,
): Metadata {
  const kind = partnerTypeLabels[profile.type];
  const title = `${fit(`${profile.displayName} - ${kind} in ${countryInSentence(profile.basedIn.code, profile.basedIn.name)}`, PARTNER_TITLE_MAX)} | ${BRAND_NAME}`;
  const own = profile.description?.replace(/\s+/g, " ").trim();
  const summary = [
    `${profile.displayName}, ${kind.toLowerCase()} based in ${countryInSentence(profile.basedIn.code, profile.basedIn.name)}`,
    profile.sourceCountries.length > 0 ? `, sources workers from ${countries(profile.sourceCountries)}` : "",
    profile.servedCountries.length > 0 ? ` for employers in ${countries(profile.servedCountries)}` : "",
    ".",
  ].join("");
  const description = own ? cut(own, VACANCY_DESCRIPTION_LENGTH).trimEnd() : fit(summary, DESCRIPTION_MAX);
  return pageMetadata(title, description, partnerProfilePath(lang, profile.slug));
}

// The title names the company, its industry and its country, then the product, as the partner profile (FR-K5 AC10). The
// description is the beginning of the company's own text, or a sentence made of its own fields. A page without an open
// vacancy holds nothing to find: it stays out of the index and of the sitemap, and its links are still followed.
export function companyPageMetadata(
  lang: string,
  page: Pick<CompanyPage, "slug" | "displayName" | "basedIn" | "industry" | "description" | "openVacancyCount">,
): Metadata {
  const country = countryInSentence(page.basedIn.code, page.basedIn.name);
  const kind = page.industry ? `${page.industry.name} company` : "Company";
  const title = `${fit(`${page.displayName} - ${kind} in ${country}`, PARTNER_TITLE_MAX)} | ${BRAND_NAME}`;
  const own = page.description?.replace(/\s+/g, " ").trim();
  const description = own
    ? cut(own, VACANCY_DESCRIPTION_LENGTH).trimEnd()
    : fit(`Open vacancies at ${page.displayName}, ${kind.toLowerCase()} based in ${country}.`, DESCRIPTION_MAX);
  const metadata = pageMetadata(title, description, companyPagePath(lang, page.slug));
  return page.openVacancyCount > 0 ? metadata : { ...metadata, robots: { index: false, follow: true } };
}
