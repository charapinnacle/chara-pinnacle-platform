import type { Page, Response } from "@playwright/test";
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
}

export async function readHead(page: Page): Promise<Head> {
  const content = (selector: string) => page.locator(selector).first().getAttribute("content");
  return {
    title: await page.title(),
    description: await content('meta[name="description"]'),
    canonical: await page.locator('link[rel="canonical"]').first().getAttribute("href"),
    ogTitle: await content('meta[property="og:title"]'),
    ogDescription: await content('meta[property="og:description"]'),
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

// Opens a path and follows the redirects that the page itself asks for (a redirect from a streamed page is a refresh
// tag, not a status), and returns the X-Robots-Tag of every document the browser was given on the way, the last one
// included.
export async function followDocuments(page: Page, path: string): Promise<{ url: string; robots: string | undefined }[]> {
  const documents: { url: string; robots: string | undefined }[] = [];
  const record = (response: Response) => {
    if (response.request().resourceType() === "document") {
      documents.push({ url: response.url(), robots: response.headers()["x-robots-tag"] });
    }
  };
  page.on("response", record);
  await page.goto(path, { waitUntil: "commit" });
  await page.waitForLoadState("load");
  for (let hops = 0; hops < 3 && (await page.locator('meta[http-equiv="refresh"]').count()) > 0; hops++) {
    const from = page.url();
    await page.waitForURL((url) => url.href !== from);
    await page.waitForLoadState("load");
  }
  page.off("response", record);
  return documents;
}
