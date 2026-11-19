import { StatusBadge } from "@/components/feedback/status-badge";
import {
  employerStatusLabels,
  partnerStatusLabels,
  responseTones,
  UPDATED_BADGE,
  type ResponseStatus,
} from "@/lib/responses/presentation";

// The status of a response in words, as the employer or the partner reads it; for the employer, Updated while an edit
// has not been opened yet (FR-O2 AC9).
export function ResponseStatusBadge({
  status,
  view,
  updatedUnseen = false,
}: {
  status: ResponseStatus;
  view: "employer" | "partner";
  updatedUnseen?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusBadge status={responseTones[status]}>{(view === "employer" ? employerStatusLabels : partnerStatusLabels)[status]}</StatusBadge>
      {view === "employer" && updatedUnseen ? <StatusBadge status="warning">{UPDATED_BADGE}</StatusBadge> : null}
    </span>
  );
}
