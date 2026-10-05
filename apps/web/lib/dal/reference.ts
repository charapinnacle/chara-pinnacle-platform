import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type ReferenceItem = { code: string; name: string };
export type OccupationItem = { code: string; label: string; synonyms: string[] };

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

type Page<Row> = { data: Row[]; error: null } | { data: null; error: PostgrestError };

// The Data API returns at most 100 rows, so a list is read in pages by code.
async function readAll<Row extends { code: string }>(
  what: string,
  readPage: (after: string | null) => PromiseLike<Page<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await readPage(rows.at(-1)?.code ?? null);
    if (error) throw new Error(`The ${what} could not be loaded`, { cause: error });
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function readNamed(table: "countries" | "industries" | "languages"): Promise<ReferenceItem[]> {
  const supabase = await createClient();
  const items = await readAll(table, (after) => {
    const request = supabase.from(table).select("code, name").order("code").limit(PAGE_SIZE);
    return after ? request.gt("code", after) : request;
  });
  return items.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export const getCountries = cache(() => readNamed("countries"));
export const getIndustries = cache(() => readNamed("industries"));
export const getLanguages = cache(() => readNamed("languages"));

export const getOccupations = cache(async (): Promise<OccupationItem[]> => {
  const supabase = await createClient();
  return readAll("occupations", (after) => {
    const request = supabase.from("occupations").select("code, label, synonyms").order("code").limit(PAGE_SIZE);
    return after ? request.gt("code", after) : request;
  });
});
