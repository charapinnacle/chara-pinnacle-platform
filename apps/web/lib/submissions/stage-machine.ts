import { allowedTargets } from "@/lib/applications/stage-machine";
import type { PipelineSubmissionStage } from "@/lib/submissions/presentation";

type EmployerTarget = "shortlisted" | "interview" | "offer" | "hired" | "rejected";

// The employer's moves of a submission are those of an application with Submitted in place of Applied (FR-O5 AC2); the
// database guard (private.submission_move_allowed) is the authority.
export function submissionTargets(status: PipelineSubmissionStage, features: { shortlisting: boolean }): EmployerTarget[] {
  return allowedTargets(status === "submitted" ? "applied" : status, "employer", features).filter(
    (target): target is EmployerTarget => target !== "applied" && target !== "viewed" && target !== "withdrawn",
  );
}
