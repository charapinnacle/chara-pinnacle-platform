import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { z } from "zod";
import { adminClient, failure, paged, type Page } from "@/lib/dal/admin";
import { ADMIN_PAGE_SIZE, type JobCursor } from "@/lib/validation/admin";

type Enums = Database["public"]["Enums"];

export type JobRow = {
  id: string;
  title: string;
  organizationName: string;
  status: Enums["job_status"];
  moderationState: Enums["job_moderation_state"];
  createdAt: string;
};

export type JobDetail = JobRow & {
  description: string;
  organizationId: string;
  countryCode: string;
  city: string;
  history: { action: "job_hidden" | "job_unhidden"; reasons: string; at: string }[];
};

const historySchema = z.array(z.object({ action: z.enum(["job_hidden", "job_unhidden"]), reasons: z.string(), at: z.string() }));

export async function searchJobs(term: string, after: JobCursor): Promise<Page<JobRow, NonNullable<JobCursor>>> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_search_jobs", {
    p_term: term,
    p_limit: ADMIN_PAGE_SIZE + 1,
    p_after_at: after?.at,
    p_after_id: after?.id,
  });
  if (error) throw failure("The vacancies", error);
  const rows = data.map(
    (row): JobRow => ({
      id: row.id,
      title: row.title,
      organizationName: row.organization_name,
      status: row.status,
      moderationState: row.moderation_state,
      createdAt: row.created_at,
    }),
  );
  return paged(rows, (row) => ({ at: row.createdAt, id: row.id }));
}

export async function getModerationJob(id: string): Promise<JobDetail | null> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_get_job", { p_job: id });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return null;
    throw failure("The vacancy", error);
  }
  const [row] = data;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    countryCode: row.country_code,
    city: row.city,
    status: row.status,
    moderationState: row.moderation_state,
    createdAt: row.created_at,
    history: historySchema.parse(row.history),
  };
}
