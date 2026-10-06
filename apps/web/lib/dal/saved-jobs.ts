import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { createClient } from "@/lib/supabase/server";
import { SAVED_PAGE_SIZE } from "@/lib/jobs/saved";

type SavedStatus = Exclude<Database["public"]["Enums"]["job_status"], "draft">;

// A vacancy the candidate saved: while it is visible, its title, employer and status; once moderation has withdrawn it,
// or it was deleted, only that it is unavailable.
export type SavedJob =
  | { id: string; savedAt: string; available: true; status: SavedStatus; title: string; employerName: string }
  | { id: string; savedAt: string; available: false };

// The candidate's saved vacancies, newest saved first, in keyset pages of SAVED_PAGE_SIZE. The function answers for the
// caller only and returns nothing that moderation withdrew.
export async function listSavedJobs(cursor: string | null): Promise<{ jobs: SavedJob[]; nextCursor: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_saved_jobs", {
    p_cursor: cursor ?? undefined,
    p_limit: SAVED_PAGE_SIZE,
  });
  if (error) throw new Error("The saved vacancies could not be loaded", { cause: error });
  return {
    jobs: data.map((row): SavedJob => {
      const { job_id: id, saved_at: savedAt, status, title, employer_display_name: employerName } = row;
      if (row.available && status && status !== "draft" && title !== null && employerName !== null) {
        return { id, savedAt, available: true, status, title, employerName };
      }
      return { id, savedAt, available: false };
    }),
    nextCursor: data.at(-1)?.next_cursor ?? null,
  };
}

// Which of the given vacancies the signed-in candidate has saved; row level security shows each caller only their own
// rows, so for anyone else the answer is none.
export async function getSavedJobIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const supabase = await createClient();
  const { data, error } = await supabase.from("saved_jobs").select("job_id").in("job_id", ids);
  if (error) throw new Error("The saved vacancies could not be loaded", { cause: error });
  return new Set(data.map((row) => row.job_id));
}
