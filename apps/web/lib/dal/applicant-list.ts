import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { z } from "zod";
import { isApplicationStatus, pipelineStages } from "@/lib/applications/presentation";
import { createClient } from "@/lib/supabase/server";
import type { ApplicantListParams, ApplicantSort } from "@/lib/validation/applicant-list";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

export const APPLICANTS_PAGE_SIZE = 50;

// The board shows the newest applications of each stage; the count of the column is the whole stage, and the rest is
// in the list filtered by that stage.
export const BOARD_COLUMN_LIMIT = 25;

export type ApplicantRow = {
  id: string;
  jobId: string;
  jobTitle: string;
  candidateName: string | null;
  status: ApplicationStatus;
  appliedAt: string;
  completeness: number;
  documents: number;
};

export type ApplicantExportRow = Omit<ApplicantRow, "id" | "jobId" | "jobTitle">;

type ApplicantAccess = {
  stageChangeBlocked: "read_only_free_plan" | null;
  shortlistingAvailable: boolean;
  csvExportAvailable: boolean;
  noteMaxChars: number;
};

export type BoardColumn = { status: ApplicationStatus; total: number; rows: ApplicantRow[] };

export type ExportRefusal = "not_found" | "not_in_plan" | "too_many_rows";

// The columns of the view are typed as nullable, so the boundary checks them.
const applicantRow = z
  .object({
    id: z.uuid(),
    job_id: z.uuid(),
    job_title: z.string(),
    candidate_name: z.string().nullable(),
    status: z.custom<ApplicationStatus>(isApplicationStatus),
    applied_at: z.string(),
    completeness: z.number().int(),
    documents: z.number().int(),
  })
  .transform((row) => ({
    id: row.id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    candidateName: row.candidate_name,
    status: row.status,
    appliedAt: row.applied_at,
    completeness: row.completeness,
    documents: row.documents,
  }));

const exportRows = z.array(
  z.object({
    candidate_name: z.string().nullable(),
    status: z.custom<ApplicationStatus>(isApplicationStatus),
    applied_at: z.string(),
    completeness: z.number().int(),
    documents: z.number().int(),
  }),
);

const columns = "id, job_id, job_title, candidate_name, status, applied_at, completeness, documents";

const sortColumns: Record<ApplicantSort, string> = {
  applied: "applied_at",
  stage: "status",
  completeness: "completeness",
  documents: "documents",
};

// What the applicant pages of the organisation offer: no row for an organisation the caller is not an active member of.
export async function getApplicantAccess(organizationId: string): Promise<ApplicantAccess | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_applicant_access", { p_organization_id: organizationId });
  if (error) throw new Error("The applicant access could not be loaded", { cause: error });
  const [row] = data;
  if (!row) return null;
  return {
    stageChangeBlocked: row.stage_change_blocked as ApplicantAccess["stageChangeBlocked"],
    shortlistingAvailable: row.shortlisting_available,
    csvExportAvailable: row.csv_export_available,
    noteMaxChars: row.note_max_chars,
  };
}

// PostgREST answers a page that starts past the last row with PGRST103, which is no failure here: the page is empty.
async function readPage(organizationId: string, params: ApplicantListParams, page: number) {
  const supabase = await createClient();
  let query = supabase.from("v_job_applicants").select(columns, { count: "exact" }).eq("organization_id", organizationId);
  if (params.job) query = query.eq("job_id", params.job);
  if (params.stage) query = query.eq("status", params.stage);
  query = query.order(sortColumns[params.sort], { ascending: params.dir === "asc" });
  if (params.sort !== "applied") query = query.order("applied_at", { ascending: false });
  const from = (page - 1) * APPLICANTS_PAGE_SIZE;
  const { data, error, count } = await query.order("id", { ascending: false }).range(from, from + APPLICANTS_PAGE_SIZE - 1);
  if (error?.code === "PGRST103") return null;
  if (error || count === null) throw new Error("The applicants could not be loaded", { cause: error });
  return { rows: data.map((row) => applicantRow.parse(row)), total: count };
}

// One page of the applicants of a vacancy, or of the whole organisation when the query names none. A page past the end
// is the last page.
export async function listApplicants(
  organizationId: string,
  params: ApplicantListParams,
): Promise<{ rows: ApplicantRow[]; total: number; page: number }> {
  const asked = await readPage(organizationId, params, params.page);
  if (asked && (asked.rows.length > 0 || params.page === 1)) return { ...asked, page: params.page };
  const first = await readPage(organizationId, params, 1);
  if (!first) throw new Error("The applicants could not be loaded");
  const lastPage = Math.max(1, Math.ceil(first.total / APPLICANTS_PAGE_SIZE));
  const last = lastPage === 1 ? first : await readPage(organizationId, params, lastPage);
  if (!last) throw new Error("The applicants could not be loaded");
  return { ...last, page: lastPage };
}

// Every column of the board is read on its own, with the count of the whole stage, in one round of requests.
export async function listBoard(organizationId: string, jobId: string): Promise<BoardColumn[]> {
  const supabase = await createClient();
  return Promise.all(
    pipelineStages.map(async (status) => {
      const { data, error, count } = await supabase
        .from("v_job_applicants")
        .select(columns, { count: "exact" })
        .eq("organization_id", organizationId)
        .eq("job_id", jobId)
        .eq("status", status)
        .order("applied_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(BOARD_COLUMN_LIMIT);
      if (error || count === null) throw new Error("The board could not be loaded", { cause: error });
      return { status, total: count, rows: data.map((row) => applicantRow.parse(row)) };
    }),
  );
}

// The rows of the list for the CSV file, all pages of the filter. The function writes the audit row.
export async function exportApplicants(
  jobId: string,
  stage: ApplicationStatus | null,
): Promise<{ rows: ApplicantExportRow[] } | { refusal: ExportRefusal }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_applicants", { p_job_id: jobId, p_stage: stage ?? undefined });
  if (error) {
    switch (error.message) {
      case "CHARA_NOT_FOUND":
        return { refusal: "not_found" };
      case "CHARA_FEATURE_NOT_IN_PLAN":
        return { refusal: "not_in_plan" };
      case "CHARA_LIMIT_REACHED":
        return { refusal: "too_many_rows" };
      default:
        throw new Error("The applicants could not be exported", { cause: error });
    }
  }
  return {
    rows: exportRows.parse(data).map((row) => ({
      candidateName: row.candidate_name,
      status: row.status,
      appliedAt: row.applied_at,
      completeness: row.completeness,
      documents: row.documents,
    })),
  };
}
