import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { SitemapVacancy } from "@/lib/seo/sitemap";

const PAGE_SIZE = 5000;

const pageSchema = z.array(z.object({ id: z.string(), created_at: z.string(), updated_at: z.string() }));

// The open, visible vacancies, newest first, in keyset pages of the function (the Data API would cut a list of rows at
// 100, one JSON value it does not); at most `limit` of them, so a table that outgrows the sitemap file costs no more
// than the file holds.
export async function listSitemapVacancies(limit: number): Promise<SitemapVacancy[]> {
  const supabase = await createClient();
  const vacancies: SitemapVacancy[] = [];
  let after: { createdAt: string; id: string } | undefined;
  while (vacancies.length < limit) {
    const size = Math.min(PAGE_SIZE, limit - vacancies.length);
    const { data, error } = await supabase.rpc("list_sitemap_jobs", {
      p_after_created: after?.createdAt,
      p_after_id: after?.id,
      p_limit: size,
    });
    if (error) throw new Error("The vacancies of the sitemap could not be loaded", { cause: error });
    const page = pageSchema.parse(data);
    vacancies.push(...page.map((entry) => ({ id: entry.id, updatedAt: entry.updated_at })));
    const last = page.at(-1);
    if (!last || page.length < size) break;
    after = { createdAt: last.created_at, id: last.id };
  }
  return vacancies;
}

// Which of the given legal slugs have a version that is published now.
export async function listPublishedLegalSlugs(slugs: readonly string[]): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("published_legal_slugs", { p_slugs: [...slugs] });
  if (error) throw new Error("The legal pages of the sitemap could not be loaded", { cause: error });
  return data;
}
