import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { isReleased } from "@/lib/dal/release";
import { getResponse, getResponseEligibility } from "@/lib/dal/responses";
import { submissionsOpen } from "@/lib/responses/presentation";
import { partnerSubmissionLabels, type SubmissionStatus } from "@/lib/submissions/presentation";
import { createClient } from "@/lib/supabase/server";

export const PARTNER_SUBMISSIONS_PAGE_SIZE = 20;

// The submission pages answer while release 2b's submissions are on (FR-O4, go-live after the DPIA [d6.3]); the partner's
// pages read its response through the job order functions too, so both switches must be on.
export async function submissionsReleased(): Promise<boolean> {
  const [submissions, jobOrders] = await Promise.all([isReleased("release_candidate_submissions"), isReleased("release_job_orders")]);
  return submissions && jobOrders;
}

// The requirement as the partner knows it through its own response (NFR-S11: the employer and the employer's title only
// once a shortlist or selection named them), and whether the partner may submit candidates now: a selected response, or a
// shortlisted one the employer opened to submissions (FR-O3 AC8), on an open requirement. null when the partner has no
// response to the requirement or may not see it, which the pages answer with the neutral 404.
export type SubmissionTarget = {
  requirementId: string;
  responseId: string;
  title: string;
  employerName: string | null;
  requirementStatus: Database["public"]["Enums"]["requirement_status"];
  open: boolean;
};

export async function getSubmissionTarget(organizationId: string, requirementId: string): Promise<SubmissionTarget | null> {
  const eligibility = await getResponseEligibility(organizationId, requirementId);
  if (!eligibility?.responseId) return null;
  const response = await getResponse(organizationId, eligibility.responseId);
  if (!response) return null;
  return {
    requirementId: response.requirementId,
    responseId: response.id,
    title: response.title,
    employerName: response.employerName,
    requirementStatus: response.requirementStatus,
    open: submissionsOpen(response.status, response.submissionsAllowed) && response.requirementStatus === "open",
  };
}

// A pending request as the candidate reads it (list_my_submission_requests, FR-O4 AC5, AC8): the requirement as the
// candidate may read it (the employer's title, city and name only when the employer shows its name, NFR-S11), and the
// partner that already submitted the candidate for the same requirement, if any.
export type SubmissionRequest = {
  id: string;
  partnerName: string;
  partnerSlug: string | null;
  title: string;
  countryCode: string;
  countryName: string;
  cityRegion: string | null;
  startDate: string | null;
  workersNeeded: number;
  employerName: string | null;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  submittedByPartner: string | null;
};

// An answered submission as the candidate reads it (list_my_submissions, FR-O4 AC9).
export type MySubmission = {
  id: string;
  status: SubmissionStatus;
  partnerName: string;
  partnerSlug: string | null;
  title: string;
  countryCode: string;
  countryName: string;
  employerName: string | null;
  createdAt: string;
  decidedAt: string | null;
  approvedAt: string | null;
  withdrawnAt: string | null;
};

// Reading them also links the requests sent to the candidate's confirmed address before it had an account (AC10).
export async function listMySubmissionRequests(): Promise<SubmissionRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_submission_requests");
  if (error) throw new Error("The submission requests could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    partnerName: row.partner_name,
    partnerSlug: row.partner_slug ?? null,
    title: row.title,
    countryCode: row.country_code,
    countryName: row.country_name,
    cityRegion: row.city_region ?? null,
    startDate: row.start_date ?? null,
    workersNeeded: row.workers_needed,
    employerName: row.employer_name ?? null,
    note: row.note ?? null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    submittedByPartner: row.submitted_by_partner ?? null,
  }));
}

export async function listMySubmissions(): Promise<MySubmission[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_submissions");
  if (error) throw new Error("The submissions could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    status: row.status,
    partnerName: row.partner_name,
    partnerSlug: row.partner_slug ?? null,
    title: row.title,
    countryCode: row.country_code,
    countryName: row.country_name,
    employerName: row.employer_name ?? null,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
    approvedAt: row.worker_approved_at ?? null,
    withdrawnAt: row.withdrawn_at ?? null,
  }));
}

// One request or submission of the candidate: there is no function for one row, so the two lists are read and the id
// looked up. Another person's id and an unknown one are both null, which the page answers with the neutral 404.
export async function getMySubmission(
  id: string,
): Promise<{ kind: "request"; request: SubmissionRequest } | { kind: "answered"; submission: MySubmission } | null> {
  const [requests, submissions] = await Promise.all([listMySubmissionRequests(), listMySubmissions()]);
  const request = requests.find((row) => row.id === id);
  if (request) return { kind: "request", request };
  const submission = submissions.find((row) => row.id === id);
  return submission ? { kind: "answered", submission } : null;
}

// A stage the submission reached from the approval on and when (FR-O5 AC4, AC10): never the note, the reason or who.
export type SubmissionStageChange = { status: SubmissionStatus; at: string };

const stagesSchema = z.array(z.object({ status: z.custom<SubmissionStatus>((value) => typeof value === "string" && Object.hasOwn(partnerSubmissionLabels, value)), at: z.string() }));

// A candidate the partner asked to submit (list_partner_submissions, FR-O4 AC12): the address until the candidate
// approves and the candidate's name after it, never a worker id; the requirement's title as the partner knows it; the
// stages the employer moved the candidate through, with their dates (FR-O5).
export type PartnerSubmission = {
  id: string;
  requirementId: string;
  title: string;
  status: SubmissionStatus;
  invitedEmail: string | null;
  candidateName: string | null;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  approvedAt: string | null;
  withdrawnAt: string | null;
  stageChangedAt: string | null;
  stages: SubmissionStageChange[];
  // Hidden by moderation (V57), with the decision an appeal names; the employer no longer sees the submission.
  hidden: { decisionId: number | null } | null;
};

export type PartnerSubmissionsPage = { submissions: PartnerSubmission[]; nextCursor: string | null; cursorIgnored: boolean };

// A page link that names no submission of the partner shows the first page instead.
export async function listPartnerSubmissions(
  organizationId: string,
  requirementId: string | null,
  cursor: string | null,
): Promise<PartnerSubmissionsPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_partner_submissions", {
    p_org: organizationId,
    p_requirement: requirementId ?? undefined,
    p_cursor: cursor ?? undefined,
    p_limit: PARTNER_SUBMISSIONS_PAGE_SIZE,
  });
  if (error) {
    if (error.message === "CHARA_INVALID_INPUT" && error.details === "p_cursor" && cursor) {
      return { ...(await listPartnerSubmissions(organizationId, requirementId, null)), cursorIgnored: true };
    }
    throw new Error("The submissions could not be loaded", { cause: error });
  }
  return {
    submissions: data.map((row) => ({
      id: row.id,
      requirementId: row.requirement_id,
      title: row.title,
      status: row.status,
      invitedEmail: row.invited_email ?? null,
      candidateName: row.candidate_name ?? null,
      note: row.note ?? null,
      createdAt: row.created_at,
      decidedAt: row.decided_at ?? null,
      approvedAt: row.worker_approved_at ?? null,
      withdrawnAt: row.withdrawn_at ?? null,
      stageChangedAt: row.stage_changed_at ?? null,
      stages: stagesSchema.catch([]).parse(row.stages),
      hidden: row.moderation_state === "hidden" ? { decisionId: row.moderation_action_id ?? null } : null,
    })),
    nextCursor: data.at(-1)?.next_cursor ?? null,
    cursorIgnored: false,
  };
}

// An approved submission to a requirement of the employer (list_requirement_submissions, FR-O4 step Deliver): never the
// address or a request the candidate has not approved. The stages, notes and documents are the pipeline's (V50).
export type RequirementSubmission = {
  id: string;
  partnerName: string;
  partnerSlug: string | null;
  status: SubmissionStatus;
  candidateName: string | null;
  note: string | null;
  approvedAt: string;
  withdrawnAt: string | null;
};

// The page reads the requirement first, so any refusal here is an error for the route's boundary.
export async function listRequirementSubmissions(organizationId: string, requirementId: string): Promise<RequirementSubmission[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_requirement_submissions", { p_org: organizationId, p_requirement: requirementId });
  if (error) throw new Error("The submissions to the requirement could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    partnerName: row.partner_name,
    partnerSlug: row.partner_slug ?? null,
    status: row.status,
    candidateName: row.candidate_name ?? null,
    note: row.note ?? null,
    approvedAt: row.worker_approved_at,
    withdrawnAt: row.withdrawn_at ?? null,
  }));
}
