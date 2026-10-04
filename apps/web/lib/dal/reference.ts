import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type ReferenceItem = { code: string; name: string };

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

// The Data API returns at most 100 rows, so the countries (about 250) are read in pages by code.
async function readList(table: "countries" | "industries"): Promise<ReferenceItem[]> {
  const supabase = await createClient();
  const items: ReferenceItem[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const last = items.at(-1)?.code;
    let request = supabase.from(table).select("code, name").order("code").limit(PAGE_SIZE);
    if (last) request = request.gt("code", last);
    const { data, error } = await request;
    if (error) throw new Error(`The ${table} could not be loaded`, { cause: error });
    items.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export const getCountries = cache(() => readList("countries"));
export const getIndustries = cache(() => readList("industries"));
