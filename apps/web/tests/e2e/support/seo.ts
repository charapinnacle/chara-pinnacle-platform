import type { Page } from "@playwright/test";
import { env } from "@/lib/env";
import { execute, literal } from "./db";
import type { Company } from "./jobs";

export const SITE = env.NEXT_PUBLIC_SITE_URL;

export interface Head {
  title: string;
  description: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
}

export async function readHead(page: Page): Promise<Head> {
  const content = (selector: string) => page.locator(selector).first().getAttribute("content");
  return {
    title: await page.title(),
    description: await content('meta[name="description"]'),
    canonical: await page.locator('link[rel="canonical"]').first().getAttribute("href"),
    ogTitle: await content('meta[property="og:title"]'),
    ogDescription: await content('meta[property="og:description"]'),
    ogImage: await content('meta[property="og:image"]'),
  };
}

// The employer as a crawler sees it: the display name and the website of the organisation.
export function nameCompany(company: Company, displayName: string, website: string | null = null): void {
  execute(
    `update public.organizations set display_name = ${literal(displayName)}, website = ${website ? literal(website) : "null"}
     where id = ${literal(company.id)}`,
  );
}

export function robotsMeta(page: Page) {
  return page.locator('meta[name="robots"]');
}

export const NOINDEX = "noindex, nofollow";

// Requests a path and follows the redirects of the answer, a Location header or the refresh tag that a streamed page
// carries in place of a status, one request at a time. Returns the X-Robots-Tag of every document on the way, the last
// one included.
export async function followDocuments(page: Page, path: string): Promise<{ url: string; robots: string | undefined }[]> {
  const documents: { url: string; robots: string | undefined }[] = [];
  let url = new URL(path, SITE).toString();
  for (let hop = 0; hop < 5; hop++) {
    const response = await page.request.get(url, { maxRedirects: 0 });
    documents.push({ url, robots: response.headers()["x-robots-tag"] });
    const refresh = /<meta[^>]*http-equiv="refresh"[^>]*content="\d+;url=([^"]+)"/.exec(await response.text())?.[1];
    const next = response.headers().location ?? refresh?.replaceAll("&amp;", "&");
    if (!next) return documents;
    url = new URL(next, url).toString();
  }
  throw new Error(`${path} redirects more than five times`);
}
