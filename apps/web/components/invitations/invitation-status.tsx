import { StatusBadge } from "@/components/feedback/status-badge";
import { employerStatusLabels, invitationTones, partnerStatusLabels, type InvitationStatus } from "@/lib/invitations/presentation";

// The status of an invitation in words, as the employer or the invited partner reads it.
export function InvitationStatusBadge({ status, view }: { status: InvitationStatus; view: "employer" | "partner" }) {
  return <StatusBadge status={invitationTones[status]}>{(view === "employer" ? employerStatusLabels : partnerStatusLabels)[status]}</StatusBadge>;
}
