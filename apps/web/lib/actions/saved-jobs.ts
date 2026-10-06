"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { requireUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { logVacancy } from "@/lib/jobs/vacancy-log";
import { savedPath } from "@/lib/jobs/saved";
import { createClient } from "@/lib/supabase/server";
import { jobIdSchema } from "@/lib/validation/job";

type SavedJobResult = { message?: string };

// Save and unsave of the signed-in candidate. The database decides: row level security admits only a worker account,
// its own rows and an Open, visible vacancy, and the primary key with ON CONFLICT makes a repeated save a no-op, also
// when two presses arrive together. An unsave of a row that is not there deletes nothing and is not an error.
export async function setSavedJob(jobId: string, saved: boolean): Promise<SavedJobResult> {
  const id = jobIdSchema.safeParse(jobId);
  if (!id.success || typeof saved !== "boolean") return { message: GENERIC_FAILURE };
  const user = await requireUser(defaultLocale);
  if (user.accountKind !== "worker") return { message: "Only candidates can save vacancies." };

  const supabase = await createClient();
  const { error } = saved
    ? await supabase
        .from("saved_jobs")
        .upsert({ worker_user_id: user.id, job_id: id.data }, { onConflict: "worker_user_id,job_id", ignoreDuplicates: true })
    : await supabase.from("saved_jobs").delete().eq("worker_user_id", user.id).eq("job_id", id.data);
  if (error) {
    if (saved && error.code === "42501" && error.message.includes("row-level security")) {
      return { message: "This vacancy can no longer be saved." };
    }
    console.error("Change saved vacancy failed", { code: error.code, message: error.message });
    return { message: GENERIC_FAILURE };
  }
  if (saved) logVacancy({ event: "vacancy_action", action: "save", jobId: id.data, viewer: "candidate" });
  revalidatePath(savedPath(defaultLocale));
  return {};
}
