import type { Database } from "@chara-pinnacle/db-types";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

export type StageRole = "employer" | "candidate";

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

const withdrawable: readonly ApplicationStatus[] = ["applied", "viewed", "shortlisted", "interview", "offer"];

// The database guard is the authority; this decides what a person is offered.
export function allowedTargets(
  status: ApplicationStatus,
  role: StageRole,
  features: { shortlisting: boolean },
): ApplicationStatus[] {
  if (role === "candidate") return withdrawable.includes(status) ? ["withdrawn"] : [];
  return employerMoves[status].filter((target) => target !== "shortlisted" || features.shortlisting);
}
