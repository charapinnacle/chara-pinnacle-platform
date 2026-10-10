import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import type { PostgrestError } from "@supabase/supabase-js";
import { cache } from "react";
import * as z from "@/lib/zod";
import { type EventActorRole, eventActorLabels, isApplicationStatus } from "@/lib/applications/presentation";
import { createClient } from "@/lib/supabase/server";
import type { ApplyLimits } from "@/lib/validation/application";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

const APPLICATIONS_PAGE_SIZE = 20;

// The Data API returns at most 100 rows: the most documents offered on the apply form, applications read for a page of
// vacancies and events read for one application.
const READ_LIMIT = 100;

export type ApplyDocument = { id: string; title: string; type: "cv" | "certificate" };

export type ApplicationState = { id: string; status: ApplicationStatus; createdAt: string };

type MyApplication = {
  id: string;
  jobTitle: string;
  employerName: string;
  status: ApplicationStatus;
  appliedAt: string;
  lastEventAt: string;
};

type ApplicationDetail = {
  id: string;
  jobId: string;
  jobTitle: string;
  employerName: string;
  status: ApplicationStatus;
  appliedAt: string;
  vacancyIsOpen: boolean;
  coverNote: string | null;
};

// The view has no id and no user id; its columns are typed as nullable, so the boundary checks them.
const timelineEvent = z.object({
  created_at: z.string(),
  to_status: z.custom<ApplicationStatus>(isApplicationStatus),
  note: z.string().nullable(),
  actor_role: z.enum(Object.keys(eventActorLabels) as [EventActorRole, ...EventActorRole[]]),
});

type TimelineEvent = {
  toStatus: ApplicationStatus;
  note: string | null;
  createdAt: string;
  actorRole: EventActorRole;
};

export type ApplyRefusal =
  | { kind: "not_open" }
  | { kind: "profile_incomplete"; missing: string[] }
  | { kind: "rate_limited" }
  | { kind: "document_not_found" }
  | { kind: "forbidden" }
  | { kind: "failed" };

type WithdrawRefusal = { kind: "not_found" } | { kind: "not_withdrawable" } | { kind: "failed" };

type ApplyResult = { kind: "created"; applicationId: string } | { kind: "existing"; applicationId: string } | ApplyRefusal;

export const getApplyLimits = cache(async (): Promise<ApplyLimits> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_limits").single();
  if (error) throw new Error("The application limits could not be loaded", { cause: error });
  return { coverNoteMaxChars: data.cover_note_max_chars, documentsMax: data.documents_max };
});

// Name and country are not null, so the occupation is the one field a passport can lack; no row means no passport.
export async function getApplyOccupation(userId: string): Promise<{ occupationId: string | null } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("worker_profiles").select("occupation_id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("The passport could not be loaded", { cause: error });
  return data ? { occupationId: data.occupation_id } : null;
}

// The candidate's own documents that can be shared, newest first; the row policy hides deleted ones and a file that
// failed its check cannot be opened by anyone, so it is not offered.
export async function getApplyDocuments(): Promise<ApplyDocument[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worker_documents")
    .select("id, title, type")
    .neq("scan_status", "rejected")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(READ_LIMIT);
  if (error) throw new Error("The documents could not be loaded", { cause: error });
  return data;
}

// The row policy limits the rows to the caller's own; a withdrawn row never hides an active one for the same vacancy.
export async function getApplicationStates(jobIds: string[]): Promise<Map<string, ApplicationState>> {
  if (jobIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_applications")
    .select("id, job_id, status, created_at")
    .in("job_id", jobIds)
    .order("created_at", { ascending: false })
    .limit(READ_LIMIT);
  if (error) throw new Error("The applications could not be loaded", { cause: error });
  const states = new Map<string, ApplicationState>();
  for (const row of data) {
    const known = states.get(row.job_id);
    if (!known || (known.status === "withdrawn" && row.status !== "withdrawn")) {
      states.set(row.job_id, { id: row.id, status: row.status, createdAt: row.created_at });
    }
  }
  return states;
}

function refusal(error: PostgrestError): ApplyRefusal {
  switch (error.message) {
    case "CHARA_JOB_NOT_OPEN":
      return { kind: "not_open" };
    case "CHARA_PROFILE_INCOMPLETE":
      return { kind: "profile_incomplete", missing: (error.details ?? "").split(", ").filter(Boolean) };
    case "CHARA_RATE_LIMITED":
      return { kind: "rate_limited" };
    case "CHARA_NOT_FOUND":
      return { kind: "document_not_found" };
    case "CHARA_FORBIDDEN":
      return { kind: "forbidden" };
    default:
      console.error("Apply to vacancy failed", { code: error.code, message: error.message });
      return { kind: "failed" };
  }
}

// A second call, also one that loses a race at the unique index, ends in the existing application: the SQL error and the
// name of the index never leave this function.
export async function applyToJob(jobId: string, note: string | null, documentIds: string[]): Promise<ApplyResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_to_job", {
    p_job_id: jobId,
    p_note: note ?? undefined,
    p_document_ids: documentIds,
  });
  if (error) {
    if (error.code === "23505") {
      const existing = (await getApplicationStates([jobId])).get(jobId);
      if (existing && existing.status !== "withdrawn") return { kind: "existing", applicationId: existing.id };
    }
    return refusal(error);
  }
  const [row] = data;
  return row.outcome === "existing"
    ? { kind: "existing", applicationId: row.application_id }
    : { kind: "created", applicationId: row.application_id };
}

// One page of the candidate's applications: the function asks one row more than the page holds to tell whether a next
// page exists, and returns nothing that is not the candidate's own.
export async function listMyApplications(
  stage: ApplicationStatus | null,
  page: number,
): Promise<{ applications: MyApplication[]; hasNext: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_applications", {
    p_stage: stage ?? undefined,
    p_limit: APPLICATIONS_PAGE_SIZE + 1,
    p_offset: (page - 1) * APPLICATIONS_PAGE_SIZE,
  });
  if (error) throw new Error("The applications could not be loaded", { cause: error });
  return {
    applications: data.slice(0, APPLICATIONS_PAGE_SIZE).map((row) => ({
      id: row.id,
      jobTitle: row.job_title,
      employerName: row.employer_display_name,
      status: row.status,
      appliedAt: row.applied_at,
      lastEventAt: row.last_event_at,
    })),
    hasNext: data.length > APPLICATIONS_PAGE_SIZE,
  };
}

// No row for an application of somebody else, whatever the id: the page answers it as it answers an unknown id.
export async function getMyApplication(id: string): Promise<ApplicationDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_application", { p_id: id });
  if (error) throw new Error("The application could not be loaded", { cause: error });
  const [row] = data;
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    employerName: row.employer_display_name,
    status: row.status,
    appliedAt: row.applied_at,
    vacancyIsOpen: row.vacancy_is_open,
    coverNote: row.cover_note,
  };
}

// The events of one application, oldest first, with the note an employer member wrote for the candidate and who acted,
// as you, employer or system. The view carries no user id of the employer.
export async function listTimeline(applicationId: string): Promise<TimelineEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_my_application_timeline")
    .select("created_at, to_status, note, actor_role")
    .eq("application_id", applicationId)
    .order("created_at")
    .limit(READ_LIMIT);
  if (error) throw new Error("The timeline could not be loaded", { cause: error });
  return data.map((row) => {
    const event = timelineEvent.parse(row);
    return { toStatus: event.to_status, note: event.note, createdAt: event.created_at, actorRole: event.actor_role };
  });
}

// The function checks that the application is the caller's own and not final; the SQL error never leaves this function.
export async function withdrawApplication(id: string): Promise<WithdrawRefusal | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_application", { p_application_id: id });
  if (!error) return null;
  switch (error.message) {
    case "CHARA_NOT_FOUND":
      return { kind: "not_found" };
    case "CHARA_INVALID_TRANSITION":
      return { kind: "not_withdrawable" };
    default:
      console.error("Withdraw application failed", { code: error.code, message: error.message });
      return { kind: "failed" };
  }
}
