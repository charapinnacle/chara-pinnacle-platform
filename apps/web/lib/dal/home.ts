import "server-only";
import { unstable_cache } from "next/cache";
import { toSearchResult, type JobSearchResult } from "@/lib/dal/hiring";
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

// The vacancy parts of the home page are not its purpose: when a read fails the page leaves them out and the error goes to
// the log, as with the statistics (FR-H4 AC12). A failure is not cached, so the next view tries again.
async function orNull<Value>(what: string, read: () => Promise<Value>): Promise<Value | null> {
  try {
    return await read();
  } catch (error) {
    console.error(`The ${what} of the home page could not be loaded`, error instanceof Error ? error.cause : error);
    return null;
  }
}

export const getNewestJobs = () => orNull("newest vacancies", readNewestJobs);
export const getIndustryCounts = (codes: readonly string[]) => orNull("industry counts", () => readIndustryCounts(codes));
