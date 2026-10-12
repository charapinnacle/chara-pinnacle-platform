import "server-only";
import { unstable_cache } from "next/cache";
import { toSearchResult, type JobSearchResult } from "@/lib/dal/hiring";
import { getCountries, getIndustries, getLanguages, getOccupations } from "@/lib/dal/reference";
import { anonymousClient } from "@/lib/supabase/anonymous";

// Kept for all visitors for a minute: a new vacancy reaches the home page within that time, and a busy home page costs the
// database one read a minute, not one per view.
const REVALIDATE_SECONDS = 60;

// The most search_jobs returns in one call. The newest of them are the cards of the page and their countries the chips, so
// the home page reads one bounded page of the public search and nothing else of the vacancies.
const NEWEST_SAMPLE = 50;

// Without a session (the answer must not depend on who asked) and without the search log: the home page is not a search.
const readNewestJobs = unstable_cache(
  async (): Promise<JobSearchResult[]> => {
    const { data, error } = await anonymousClient().rpc("search_jobs", { p_limit: NEWEST_SAMPLE });
    if (error) throw new Error("The newest vacancies could not be loaded", { cause: error });
    return data.map(toSearchResult);
  },
  ["home", "newest-jobs"],
  { revalidate: REVALIDATE_SECONDS },
);

// One count per industry tile, each an index scan of the open vacancies of one industry (jobs_public_industry_idx);
// row level security limits the anonymous client to the open, visible, undeleted vacancies.
const readIndustryCounts = unstable_cache(
  async (codes: readonly string[]): Promise<Record<string, number>> => {
    const supabase = anonymousClient();
    const counts = await Promise.all(
      codes.map(async (code) => {
        const { count, error } = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("industry_code", code);
        if (error) throw new Error("The vacancies of an industry could not be counted", { cause: error });
        return [code, count ?? 0] as const;
      }),
    );
    return Object.fromEntries(counts);
  },
  ["home", "industry-counts"],
  { revalidate: REVALIDATE_SECONDS },
);

// Every read of the home page but the statistics (which cope on their own) serves a part of it, not its purpose: when one
// fails the page leaves that part out and the code goes to the log, as with the statistics (FR-H4 AC12). Only the code and
// the message are logged, as in the other readers. A failure is not cached, so the next view tries again.
async function orNull<Value>(what: string, read: () => Promise<Value>): Promise<Value | null> {
  try {
    return await read();
  } catch (error) {
    const cause: unknown = error instanceof Error ? error.cause : undefined;
    const known = typeof cause === "object" && cause !== null;
    console.error(`The ${what} of the home page could not be loaded`, {
      code: known && "code" in cause ? cause.code : undefined,
      message: known && "message" in cause ? cause.message : undefined,
    });
    return null;
  }
}

export const getNewestJobs = () => orNull("newest vacancies", readNewestJobs);
export const getIndustryCounts = (codes: readonly string[]) => orNull("industry counts", () => readIndustryCounts(codes));

// The popular searches, the names of the countries and the reach band come from the cached reference lists, which a new
// instance or the end of their cache reads again.
export const getHomeReference = () =>
  orNull("reference data", async () => {
    const [occupations, countries, industries, languages] = await Promise.all([getOccupations(), getCountries(), getIndustries(), getLanguages()]);
    return { occupations, countries, industries, languages };
  });
