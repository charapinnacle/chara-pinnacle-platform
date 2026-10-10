import "server-only";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import type { SitemapVacancy } from "@/lib/seo/sitemap";

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

// Row level security hides the versions that are not published yet. A slug can have several versions, so the cut of the
// Data API (100 rows) would only matter at ten versions of every page.
export async function listPublishedLegalSlugs(slugs: readonly string[]): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("legal_documents").select("slug").in("slug", [...slugs]).limit(100);
  if (error) throw new Error("The legal pages of the sitemap could not be loaded", { cause: error });
  const published = new Set(data.map(({ slug }) => slug));
  return slugs.filter((slug) => published.has(slug));
}
