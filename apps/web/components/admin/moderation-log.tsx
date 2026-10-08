import { Gavel } from "lucide-react";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { listModerationActions } from "@/lib/dal/admin";
import { formatDateTime } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";

const actionLabels: Record<string, string> = {
  account_suspended: "Account suspended",
  account_reinstated: "Account reinstated",
  organization_suspended: "Organisation suspended",
  organization_reinstated: "Organisation reinstated",
};

export async function ModerationLog({ lang, after }: { lang: string; after: number | null }) {
  const page = await listModerationActions(after);
  if (page.rows.length === 0) return <EmptyState icon={Gavel} title="No suspensions or reinstatements yet" />;

  return (
    <div className="grid gap-4">
      <ResultsTable caption="Suspensions and reinstatements, newest first" columns={["Time", "Action", "Target", "Reasons"]}>
        {page.rows.map((row) => (
          <tr key={row.id}>
            <td className={cell}>{formatDateTime(row.createdAt)}</td>
            <td className={cell}>{actionLabels[row.action] ?? row.action}</td>
            <td className={`${cell} break-words`}>
              <TextLink href={adminPath(lang, `${row.targetType === "organization" ? "organizations" : "users"}/${row.targetId}`)}>
                {row.targetName ?? row.targetId}
              </TextLink>
            </td>
            <td className={`${cell} break-words`}>{row.reasons}</td>
          </tr>
        ))}
      </ResultsTable>
      {page.next ? (
        <TextLink standalone href={`${adminPath(lang, "suspensions")}?after=${page.next}`}>
          Show older entries
        </TextLink>
      ) : null}
    </div>
  );
}
