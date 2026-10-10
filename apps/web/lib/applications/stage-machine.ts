import type { Database } from "@chara-pinnacle/db-types";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

type StageRole = "employer" | "candidate";

// The moves of an employer member (ARCHITECTURE.md section 4). Viewed is the system's, Withdrawn the candidate's, and the
// three final states have no way out.
const employerMoves: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  applied: ["shortlisted", "interview", "rejected"],
  viewed: ["shortlisted", "interview", "rejected"],
  shortlisted: ["interview", "offer", "rejected"],
  interview: ["offer", "rejected"],
  offer: ["hired", "rejected"],
  hired: [],
  rejected: [],
  withdrawn: [],
};

// The stages in which a candidate still waits for a decision: neither decided (hired, not selected) nor withdrawn. These
// are the ones a candidate can withdraw from.
export const openStages: readonly ApplicationStatus[] = ["applied", "viewed", "shortlisted", "interview", "offer"];

// The database guard is the authority; this decides what a person is offered.
export function allowedTargets(
  status: ApplicationStatus,
  role: StageRole,
  features: { shortlisting: boolean },
): ApplicationStatus[] {
  if (role === "candidate") return openStages.includes(status) ? ["withdrawn"] : [];
  return employerMoves[status].filter((target) => target !== "shortlisted" || features.shortlisting);
}
