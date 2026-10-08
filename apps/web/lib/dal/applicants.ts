import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

type Applicant = {
  id: string;
  organizationId: string;
  jobTitle: string;
  applicantName: string | null;
  status: ApplicationStatus;
  appliedAt: string;
  shortlistingAvailable: boolean;
  stageChangeBlocked: "read_only_free_plan" | null;
  noteMaxChars: number;
};

type ApplicantEvent = {
  id: number;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  actor: "candidate" | "employer" | "system";
  actorName: string | null;
  note: string | null;
  createdAt: string;
};

export type StageRefusal =
  | { kind: "already_moved" }
  | { kind: "not_found" }
  | { kind: "blocked"; reason: "organization_suspended" | "read_only_free_plan" }
  | { kind: "shortlisting_not_in_plan" }
  | { kind: "note_too_long" }
  | { kind: "failed" };

// No row for an application the caller cannot see, whatever the reason: the page answers it as an unknown id.
export async function getApplicant(id: string): Promise<Applicant | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_applicant", { p_application_id: id });
  if (error) throw new Error("The applicant could not be loaded", { cause: error });
  const [row] = data;
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    jobTitle: row.job_title,
    applicantName: row.applicant_name,
    status: row.status,
    appliedAt: row.applied_at,
    shortlistingAvailable: row.shortlisting_available,
    stageChangeBlocked: row.stage_change_blocked as Applicant["stageChangeBlocked"],
    noteMaxChars: row.note_max_chars,
  };
}

export async function listApplicantEvents(id: string): Promise<ApplicantEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_applicant_events", { p_application_id: id });
  if (error) throw new Error("The history could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actor: row.actor_kind as ApplicantEvent["actor"],
    actorName: row.actor_name,
    note: row.note,
    createdAt: row.created_at,
  }));
}

// The first open of an application by a member is the system's move to Viewed. An application the caller cannot see is
// not an error here: the page that follows shows it as not found.
export async function markApplicationViewed(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_application_viewed", { p_application_id: id });
  if (error && error.message !== "CHARA_NOT_FOUND") {
    throw new Error("The application could not be marked as viewed", { cause: error });
  }
}

function refusal(error: PostgrestError): StageRefusal {
  switch (error.message) {
    case "CHARA_INVALID_TRANSITION":
      return { kind: "already_moved" };
    case "CHARA_NOT_FOUND":
      return { kind: "not_found" };
    case "CHARA_FORBIDDEN":
      return error.details === "organization_suspended" ? { kind: "blocked", reason: "organization_suspended" } : { kind: "failed" };
    case "CHARA_FEATURE_NOT_IN_PLAN":
      return error.details === "shortlisting"
        ? { kind: "shortlisting_not_in_plan" }
        : { kind: "blocked", reason: "read_only_free_plan" };
    case "CHARA_INVALID_INPUT":
      return error.details === "p_note" ? { kind: "note_too_long" } : { kind: "failed" };
    default:
      console.error("Change of application status failed", { code: error.code, message: error.message });
      return { kind: "failed" };
  }
}

export async function setApplicationStatus(
  id: string,
  status: ApplicationStatus,
  note: string,
): Promise<StageRefusal | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_application_status", {
    p_application_id: id,
    p_status: status,
    p_note: note === "" ? undefined : note,
  });
  return error ? refusal(error) : null;
}

export type BulkItem = { applicationId: string; ok: boolean; errorCode: string | null; status: ApplicationStatus | null };

// One call for up to 100 applications of one organization. The ids are first matched to that organization in one bounded
// read, so that the role the caller was checked for is the one of the organization that owns every application sent; an
// id that is not there is answered as the database answers an unknown id. The database judges the rest, item by item, and
// the stage read here is the one a refused item is in. A refusal of the whole call (a lapsed plan, a suspended
// organization, a note that is too long) is a StageRefusal.
export async function bulkSetApplicationStatus(
  organizationId: string,
  ids: string[],
  status: ApplicationStatus,
  note: string,
): Promise<{ items: BulkItem[] } | { refusal: StageRefusal }> {
  const supabase = await createClient();
  const { data: rows, error: readError } = await supabase
    .from("v_job_applicants")
    .select("id, status")
    .eq("organization_id", organizationId)
    .in("id", ids);
  if (readError) return { refusal: refusal(readError) };
  const current = new Map<string, ApplicationStatus>();
  for (const row of rows) if (row.id && row.status) current.set(row.id, row.status);

  const distinct = [...new Set(ids)];
  const own = distinct.filter((id) => current.has(id));
  const judged = new Map<string, { ok: boolean; error_code: string | null }>();
  if (own.length > 0) {
    const { data, error } = await supabase.rpc("bulk_set_application_status", {
      p_application_ids: own,
      p_status: status,
      p_note: note === "" ? undefined : note,
    });
    if (error) return { refusal: refusal(error) };
    for (const item of data) judged.set(item.application_id, item);
  }
  return {
    items: distinct.map((id) => {
      const item = judged.get(id);
      if (!item) return { applicationId: id, ok: false, errorCode: "CHARA_NOT_FOUND", status: null };
      return { applicationId: id, ok: item.ok, errorCode: item.ok ? null : item.error_code, status: item.ok ? null : (current.get(id) ?? null) };
    }),
  };
}
