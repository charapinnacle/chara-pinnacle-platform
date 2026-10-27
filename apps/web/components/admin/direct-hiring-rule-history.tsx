import { History } from "lucide-react";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Section } from "@/components/layout/section";
import { listDirectHiringRuleHistory } from "@/lib/dal/direct-hiring-rules";
import { formatDateTime } from "@/lib/i18n/format";
import { changeText } from "@/lib/validation/direct-hiring-rules";

// The latest changes of the rules from the audit log, newest first (FR-Q5 AC1, AC12; SOP control "audit trail").
export async function DirectHiringRuleHistory() {
  const changes = await listDirectHiringRuleHistory();
  return (
    <Section id="changes" title="Changes" description="The latest 50 changes, newest first, with the administrator and the reason.">
      {changes.length === 0 ? (
        <EmptyState icon={History} flat title="No changes recorded" />
      ) : (
        <ResultsTable caption="Changes of the direct-hiring rules, newest first" columns={["Time", "Administrator", "Change", "Reason"]}>
          {changes.map((change) => (
            <tr key={change.id}>
              <td className={`${cell} whitespace-nowrap`}>
                <time dateTime={change.createdAt}>{formatDateTime(change.createdAt)}</time>
              </td>
              <td className={`${cell} break-words`}>{change.actorName ?? "Migration"}</td>
              <td className={`${cell} break-words`}>{changeText(change)}</td>
              <td className={`${cell} break-words`}>{change.reason ?? <span className="text-muted-foreground">None recorded</span>}</td>
            </tr>
          ))}
        </ResultsTable>
      )}
    </Section>
  );
}
