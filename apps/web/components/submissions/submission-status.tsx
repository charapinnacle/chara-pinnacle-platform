import { StatusBadge } from "@/components/feedback/status-badge";
import {
  CLOSED_SUBMISSION_LABEL,
  candidateSubmissionLabels,
  partnerSubmissionLabels,
  submissionTones,
  type SubmissionStatus,
} from "@/lib/submissions/presentation";

// The status of a submission in words, as the candidate or the partner reads it (NFR-U4); a request closed with the
// partner's permission reads Closed rather than Expired.
export function SubmissionStatusBadge({
  status,
  view,
  closed = false,
}: {
  status: SubmissionStatus;
  view: "candidate" | "partner";
  closed?: boolean;
}) {
  return (
    <StatusBadge status={submissionTones[status]}>
      {closed ? CLOSED_SUBMISSION_LABEL : (view === "candidate" ? candidateSubmissionLabels : partnerSubmissionLabels)[status]}
    </StatusBadge>
  );
}
