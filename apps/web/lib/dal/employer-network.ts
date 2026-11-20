import "server-only";
import * as z from "zod";
import type { EmployerNetwork } from "@/lib/dashboard/employer-network";
import { pipelineSubmissionStages, type PipelineSubmissionStage } from "@/lib/submissions/presentation";
import { createClient } from "@/lib/supabase/server";

const count = z.number().int().nonnegative();

const stagesSchema = z.object(
  Object.fromEntries(pipelineSubmissionStages.map((stage) => [stage, count])) as Record<PipelineSubmissionStage, typeof count>,
);

const requirementSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["draft", "open", "paused", "closed", "filled"]),
  closes_on: z.string().nullable(),
  responses: count,
  selected: count,
  awaiting_decision: count,
  updated_unseen: count,
  invitations_waiting: count,
});

const networkRow = z.object({
  saved_partners: count,
  followed_companies: count,
  open_requirements: count.nullable(),
  paused_requirements: count.nullable(),
  draft_requirements: count.nullable(),
  requirements: z.array(requirementSchema).nullable(),
  invited_partners: count.nullable(),
  invited_recruitment: count.nullable(),
  invited_staffing: count.nullable(),
  invitations_waiting: count.nullable(),
  invitations_accepted: count.nullable(),
  invitations_responded: count.nullable(),
  invitations_declined: count.nullable(),
  responses_waiting: count.nullable(),
  responses_updated: count.nullable(),
  responses_shortlisted: count.nullable(),
  selected_partners: count.nullable(),
  submission_stages: stagesSchema.nullable(),
});

// The partner network figures of an employer dashboard (FR-R5), read again on every request in one call; the function
// refuses anyone who is not a member of the employer.
export async function getEmployerNetwork(organizationId: string): Promise<EmployerNetwork> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_employer_network_dashboard", {
    p_org: organizationId,
  });
  if (error)
    throw new Error("The partner network figures could not be loaded", {
      cause: error,
    });
  const row = networkRow.parse(data[0]);
  return {
    savedPartners: row.saved_partners,
    followedCompanies: row.followed_companies,
    // The function returns every figure of release 2b or none of them.
    requirements:
      row.requirements === null
        ? null
        : {
            open: row.open_requirements ?? 0,
            paused: row.paused_requirements ?? 0,
            drafts: row.draft_requirements ?? 0,
            listed: row.requirements.map((item) => ({
              id: item.id,
              title: item.title,
              status: item.status,
              closesOn: item.closes_on,
              responses: item.responses,
              selected: item.selected,
              awaitingDecision: item.awaiting_decision,
              updatedUnseen: item.updated_unseen,
              invitationsWaiting: item.invitations_waiting,
            })),
            invitedPartners: row.invited_partners ?? 0,
            invitedRecruitment: row.invited_recruitment ?? 0,
            invitedStaffing: row.invited_staffing ?? 0,
            invitationsWaiting: row.invitations_waiting ?? 0,
            invitationsAccepted: row.invitations_accepted ?? 0,
            invitationsResponded: row.invitations_responded ?? 0,
            invitationsDeclined: row.invitations_declined ?? 0,
            responsesWaiting: row.responses_waiting ?? 0,
            responsesUpdated: row.responses_updated ?? 0,
            responsesShortlisted: row.responses_shortlisted ?? 0,
            selectedPartners: row.selected_partners ?? 0,
          },
    submissionStages: row.submission_stages,
  };
}
