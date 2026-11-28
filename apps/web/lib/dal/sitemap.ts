import "server-only";
import * as z from "zod";
import { corridorPagePath } from "@/lib/corridors/presentation";
import { listCorridors } from "@/lib/dal/corridors";
import { createClient } from "@/lib/supabase/server";
import type { SitemapCompany, SitemapPartner, SitemapVacancy } from "@/lib/seo/sitemap";

const pageSchema = z.array(z.object({ id: z.string(), created_at: z.string(), updated_at: z.string() }));

// The Data API cuts a list of rows at 100, not one JSON value, so the vacancies come as pages of a function. The page
// size is capped by the function, never here: the loop asks for what is left and ends on an empty page, so a cap that
// changes in the database cannot end it early. At most `limit` vacancies, so a table that outgrows the file costs no more
// than the file holds.
export async function listSitemapVacancies(limit: number): Promise<SitemapVacancy[]> {
  const supabase = await createClient();
  const vacancies: SitemapVacancy[] = [];
  let after: { createdAt: string; id: string } | undefined;
  while (vacancies.length < limit) {
    const { data, error } = await supabase.rpc("list_sitemap_jobs", {
      p_after_created: after?.createdAt,
      p_after_id: after?.id,
      p_limit: limit - vacancies.length,
    });
    if (error) throw new Error("The vacancies of the sitemap could not be loaded", { cause: error });
    const page = pageSchema.parse(data);
    const last = page.at(-1);
    if (!last) break;
    vacancies.push(...page.map((entry) => ({ id: entry.id, updatedAt: entry.updated_at })));
    after = { createdAt: last.created_at, id: last.id };
  }
  return vacancies;
}

const partnerPageSchema = z.array(z.object({ slug: z.string(), updated_at: z.string() }));

// The public partner profiles (FR-K4 AC7), in pages of the function as the vacancies above, after the slug of the last
// entry. The function answers an empty list while release 2a is off.
export async function listSitemapPartners(limit: number): Promise<SitemapPartner[]> {
  const supabase = await createClient();
  const partners: SitemapPartner[] = [];
  let after: string | undefined;
  while (partners.length < limit) {
    const { data, error } = await supabase.rpc("list_sitemap_partners", { p_after_slug: after, p_limit: limit - partners.length });
    if (error) throw new Error("The partner profiles of the sitemap could not be loaded", { cause: error });
    const page = partnerPageSchema.parse(data);
    const last = page.at(-1);
    if (!last) break;
    partners.push(...page.map((entry) => ({ slug: entry.slug, updatedAt: entry.updated_at })));
    after = last.slug;
  }
  return partners;
}

// The public company pages with an open vacancy (FR-K5 AC10), in pages after the slug of the last entry as the partner
// profiles above. The function answers an empty list while release 2a is off.
export async function listSitemapCompanies(limit: number): Promise<SitemapCompany[]> {
  const supabase = await createClient();
  const companies: SitemapCompany[] = [];
  let after: string | undefined;
  while (companies.length < limit) {
    const { data, error } = await supabase.rpc("list_sitemap_companies", { p_after_slug: after, p_limit: limit - companies.length });
    if (error) throw new Error("The company pages of the sitemap could not be loaded", { cause: error });
    const page = partnerPageSchema.parse(data);
    const last = page.at(-1);
    if (!last) break;
    companies.push(...page.map((entry) => ({ slug: entry.slug, updatedAt: entry.updated_at })));
    after = last.slug;
  }
  return companies;
}

// Row level security hides the versions that are not published yet. A slug can have several versions, so the cut of the
// Data API (100 rows) would only matter at ten versions of every page.
export async function listPublishedLegalSlugs(slugs: readonly string[]): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("legal_documents").select("slug").in("slug", [...slugs]).limit(100);
  if (error) throw new Error("The legal pages of the sitemap could not be loaded", { cause: error });
  const published = new Set(data.map(({ slug }) => slug));
  return slugs.filter((slug) => published.has(slug));
}

// The listed corridors (those with enough partners), whose pages are indexed; none while release_corridors is off. A
// corridor below the threshold keeps its page but stays out of the sitemap.
export async function listSitemapCorridorPaths(): Promise<string[]> {
  const list = await listCorridors();
  return list?.corridors.map((row) => corridorPagePath(row.source_country, row.destination_country)) ?? [];
}
