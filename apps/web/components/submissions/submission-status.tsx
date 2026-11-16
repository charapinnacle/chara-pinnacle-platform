import { StatusBadge } from "@/components/feedback/status-badge";
import {
  candidateSubmissionLabels,
  partnerSubmissionLabels,
  submissionTones,
  type SubmissionStatus,
} from "@/lib/submissions/presentation";

// The status of a submission in words, as the candidate or the partner reads it (NFR-U4).
export function SubmissionStatusBadge({ status, view }: { status: SubmissionStatus; view: "candidate" | "partner" }) {
  return (
    <StatusBadge status={submissionTones[status]}>
      {(view === "candidate" ? candidateSubmissionLabels : partnerSubmissionLabels)[status]}
    </StatusBadge>
  );
}
