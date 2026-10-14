import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { createClient, type PostgrestError } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { env } from "@/lib/env";

export type ReferenceItem = { code: string; name: string };
export type OccupationItem = { code: string; label: string; synonyms: string[] };

const PAGE_SIZE = 100;
const REVALIDATE_SECONDS = 6 * 60 * 60;

// The lists are public and change only with a migration, so they are read once for all visitors and kept for hours,
// not once per page view. The client holds no session: a cached value must never depend on who asked.
const anonymousClient = () =>
  createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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

async function readNamed(table: "countries" | "currencies" | "industries" | "languages"): Promise<ReferenceItem[]> {
  const supabase = anonymousClient();
  const items = await readAll(table, (from) =>
    supabase.from(table).select("code, name", { count: "exact" }).order("code").range(from, from + PAGE_SIZE - 1),
  );
  return items.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

const cached = <Value>(key: string, read: () => Promise<Value>) =>
  unstable_cache(read, ["reference", key], { revalidate: REVALIDATE_SECONDS });

export const getCountries = cached("countries", () => readNamed("countries"));
export const getCurrencies = cached("currencies", () => readNamed("currencies"));
export const getIndustries = cached("industries", () => readNamed("industries"));
export const getLanguages = cached("languages", () => readNamed("languages"));

export const getOccupations = cached("occupations", async (): Promise<OccupationItem[]> => {
  const supabase = anonymousClient();
  return readAll("occupations", (from) =>
    supabase.from("occupations").select("code, label, synonyms", { count: "exact" }).order("code").range(from, from + PAGE_SIZE - 1),
  );
});
