import type { Database } from "@chara-pinnacle/db-types";
import type { EmployerRequests, MatchingWorkers } from "@/lib/dashboard/connections";
import { formatCount } from "@/lib/i18n/format";
import { employerSubmissionLabels, pipelineSubmissionStages, type PipelineSubmissionStage } from "@/lib/submissions/presentation";

type RequirementStatus = Database["public"]["Enums"]["requirement_status"];

// The question the partner network part of the employer dashboard answers (spec §30, FR-R5 AC1).
export const EMPLOYER_NETWORK_QUESTION = "Who can help me fill my workforce requirement?";

// An open or paused requirement as the dashboard lists it (FR-R5 AC3): the employer's own title and its counts.
export type NetworkRequirement = {
  id: string;
  title: string;
  status: RequirementStatus;
  closesOn: string | null;
  responses: number;
  selected: number;
  awaitingDecision: number;
  updatedUnseen: number;
  invitationsWaiting: number;
};

// The figures of release 2b, null while job orders are off (FR-R5 AC7).
export type RequirementFigures = {
  open: number;
  paused: number;
  drafts: number;
  listed: NetworkRequirement[];
  invitedPartners: number;
  invitedRecruitment: number;
  invitedStaffing: number;
  invitationsWaiting: number;
  invitationsAccepted: number;
  invitationsResponded: number;
  invitationsDeclined: number;
  responsesWaiting: number;
  responsesUpdated: number;
  responsesShortlisted: number;
  selectedPartners: number;
};

// The figures of get_employer_network_dashboard.
export type EmployerNetwork = {
  savedPartners: number;
  followedCompanies: number;
  requirements: RequirementFigures | null;
  // The approved candidates by pipeline stage, null while candidate submissions are off.
  submissionStages: Record<PipelineSubmissionStage, number> | null;
  // The employer's inquiries and workforce requests, null while messaging is off.
  requests: EmployerRequests | null;
  // The listed Find Workers cards fitting the open requirements and vacancies, null while Find Workers is off (FR-R5 AC5).
  matchingWorkers: MatchingWorkers | null;
};

const plural = (count: number, one: string, other: string) => `${formatCount(count)} ${count === 1 ? one : other}`;

export function responsesText(count: number): string {
  return plural(count, "response", "responses");
}

export type RequirementAction = {
  kind: "decide" | "invite" | "responses";
  text: string;
};

// What the employer does next with one requirement (NFR-U4): decide on the responses that wait, invite partners while
// nobody was asked or answered, else read the responses.
export function requirementAction(requirement: NetworkRequirement): RequirementAction {
  if (requirement.awaitingDecision > 0) {
    return {
      kind: "decide",
      text: `Decide on ${plural(requirement.awaitingDecision, "response", "responses")}`,
    };
  }
  if (requirement.responses === 0 && requirement.invitationsWaiting === 0) {
    return { kind: "invite", text: "Invite partners" };
  }
  return { kind: "responses", text: "See the responses" };
}

// The requirement whose responses to review first: the first listed one with a response waiting, preferring an update
// the employer has not opened.
export function firstWaiting(listed: readonly NetworkRequirement[]): NetworkRequirement | null {
  return listed.find((item) => item.updatedUnseen > 0) ?? listed.find((item) => item.awaitingDecision > 0) ?? null;
}

// The answers of the partners invited to open and paused requirements, those above 0, in the order an invitation moves.
export function invitationAnswerLines(figures: RequirementFigures): { label: string; count: number }[] {
  return [
    {
      label: "Waiting for the partner's answer",
      count: figures.invitationsWaiting,
    },
    { label: "Accepted, response to come", count: figures.invitationsAccepted },
    { label: "Responded", count: figures.invitationsResponded },
    { label: "Declined", count: figures.invitationsDeclined },
  ].filter((line) => line.count > 0);
}

// "3 partners: 2 recruitment, 1 staffing", the type at 0 left out.
export function invitedPartnersText(figures: RequirementFigures): string {
  const parts = [
    figures.invitedRecruitment > 0 ? `${formatCount(figures.invitedRecruitment)} recruitment` : null,
    figures.invitedStaffing > 0 ? `${formatCount(figures.invitedStaffing)} staffing` : null,
  ].filter((part) => part !== null);
  const head = plural(figures.invitedPartners, "partner", "partners");
  return parts.length > 0 ? `${head}: ${parts.join(", ")}` : head;
}

const stageLabels: Record<PipelineSubmissionStage, string> = {
  ...employerSubmissionLabels,
  submitted: "New, not opened yet",
};

// The pipeline stages that hold a candidate, in the order a submission moves; none when no candidate was submitted.
export function employerStageLines(
  stages: Record<PipelineSubmissionStage, number>,
): { stage: PipelineSubmissionStage; label: string; count: number }[] {
  return pipelineSubmissionStages
    .filter((stage) => stages[stage] > 0)
    .map((stage) => ({
      stage,
      label: stageLabels[stage],
      count: stages[stage],
    }));
}
