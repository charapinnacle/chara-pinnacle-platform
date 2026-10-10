import { StatusBadge } from "@/components/feedback/status-badge";
import { accountStatusLabels, accountStatusTones, type AccountStatus } from "@/lib/admin/status";

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  return <StatusBadge status={accountStatusTones[status]}>{accountStatusLabels[status]}</StatusBadge>;
}
