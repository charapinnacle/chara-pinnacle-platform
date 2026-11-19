import { Archive } from "lucide-react";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { RetentionDialog } from "@/components/admin/retention-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { listRetentionPolicies } from "@/lib/dal/retention";
import { monthsText } from "@/lib/validation/retention";

// The retention periods (FR-S3 AC10, NFR-O5): each with its period in days and months. The audit log and inactive
// candidate account periods are shown but changed by a reviewed migration only.
export async function RetentionList() {
  const policies = await listRetentionPolicies();
  if (policies.length === 0) return <EmptyState icon={Archive} title="No retention periods are set" />;

  return (
    <ResultsTable caption="Retention periods" columns={["Data", "Days", "Months", "Actions"]}>
      {policies.map((policy) => (
        <tr key={policy.entity}>
          <td className={`${cell} break-words`}>
            <span className="block font-medium">{policy.label}</span>
            <span className="block text-small text-muted-foreground">{policy.description}</span>
          </td>
          <td className={`${cell} tabular-nums`}>{policy.days.toLocaleString("en-GB")}</td>
          <td className={`${cell} tabular-nums`}>{monthsText(policy.days)}</td>
          <td className={cell}>
            {policy.editable ? <RetentionDialog policy={policy} /> : <span className="text-small text-muted-foreground">Changed by migration only</span>}
          </td>
        </tr>
      ))}
    </ResultsTable>
  );
}
