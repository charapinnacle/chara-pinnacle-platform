import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type ReferenceItem = { code: string; name: string };
export type OccupationItem = { code: string; label: string; synonyms: string[] };

const PAGE_SIZE = 100;

type Page<Row> = { data: Row[]; count: number | null; error: null } | { data: null; count: null; error: PostgrestError };

// The Data API returns at most 100 rows. The first page also reports the total, so the other pages are read together.
async function readAll<Row>(what: string, readPage: (from: number) => PromiseLike<Page<Row>>): Promise<Row[]> {
  const first = await readPage(0);
  if (first.error) throw new Error(`The ${what} could not be loaded`, { cause: first.error });
  const pages = Math.ceil((first.count ?? 0) / PAGE_SIZE);
  const starts = Array.from({ length: Math.max(pages - 1, 0) }, (_, index) => (index + 1) * PAGE_SIZE);
  const rest = await Promise.all(starts.map(readPage));
  return [first, ...rest].flatMap((page) => {
    if (page.error) throw new Error(`The ${what} could not be loaded`, { cause: page.error });
    return page.data;
  });
}

async function readNamed(table: "countries" | "industries" | "languages"): Promise<ReferenceItem[]> {
  const supabase = await createClient();
  const items = await readAll(table, (from) =>
    supabase.from(table).select("code, name", { count: "exact" }).order("code").range(from, from + PAGE_SIZE - 1),
  );
  return items.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export const getCountries = cache(() => readNamed("countries"));
export const getIndustries = cache(() => readNamed("industries"));
export const getLanguages = cache(() => readNamed("languages"));

export const getOccupations = cache(async (): Promise<OccupationItem[]> => {
  const supabase = await createClient();
  return readAll("occupations", (from) =>
    supabase.from("occupations").select("code, label, synonyms", { count: "exact" }).order("code").range(from, from + PAGE_SIZE - 1),
  );
});
