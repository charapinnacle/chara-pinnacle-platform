import { History } from "lucide-react";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { historyValues } from "@/lib/admin/plan-history";
import { listPlanHistory } from "@/lib/dal/plan-editor";
import { formatDateTime } from "@/lib/i18n/format";

// The changes of one plan from the audit log, newest first (FR-R2 AC11): time, administrator, field, old and new value
// and reason. A row written by a migration has no administrator.
export async function PlanHistory({ code }: { code: string }) {
  const rows = await listPlanHistory(code);
  if (rows.length === 0) return <EmptyState icon={History} title="No changes recorded" description="Changes to this plan appear here, newest first." />;

  return (
    <ResultsTable caption={`Changes of ${code}, newest first`} columns={["Time", "Administrator", "Field", "Old value", "New value", "Reason"]}>
      {rows.map((row) => {
        const values = historyValues(row);
        return (
          <tr key={row.id}>
            <td className={`${cell} whitespace-nowrap`}>
              <time dateTime={row.createdAt}>{formatDateTime(row.createdAt)}</time>
            </td>
            <td className={`${cell} break-words`}>{row.actorName ?? "Migration"}</td>
            <td className={`${cell} break-all`}>{row.field}</td>
            <td className={`${cell} break-words`}>{values.from}</td>
            <td className={`${cell} break-words`}>{values.to}</td>
            <td className={`${cell} break-words`}>{row.reason ?? <span className="text-muted-foreground">None recorded</span>}</td>
          </tr>
        );
      })}
    </ResultsTable>
  );
}
