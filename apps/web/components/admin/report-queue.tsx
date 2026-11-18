import { Flag } from "lucide-react";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { FormButton } from "@/components/forms/form-button";
import { NativeSelect } from "@/components/forms/native-select";
import { TextLink } from "@/components/forms/text-link";
import { listReports } from "@/lib/dal/admin-reports";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import {
  FEE_DEMAND_LABEL,
  isFeeDemand,
  reportCategoryLabels,
  reportQueueCursorParam,
  reportListStatusLabels,
  reportStatusLabels,
  reportStatusTones,
  reportTargetLabels,
  type ReportListFilter,
  type ReportQueueCursor,
} from "@/lib/validation/report";

function Filters({ lang, filter }: { lang: string; filter: ReportListFilter }) {
  return (
    <form action={adminPath(lang, "reports")} method="get" role="search" aria-label="Filter reports" className="flex flex-wrap items-end gap-3">
      <div className="grid gap-2 sm:w-64">
        <label htmlFor="report-status-filter" className="text-small leading-snug font-medium">
          Status
        </label>
        <NativeSelect id="report-status-filter" name="status" defaultValue={filter.status}>
          {Object.entries(reportListStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-2 sm:w-64">
        <label htmlFor="report-type-filter" className="text-small leading-snug font-medium">
          About
        </label>
        <NativeSelect id="report-type-filter" name="type" defaultValue={filter.type ?? ""}>
          <option value="">Everything</option>
          {Object.entries(reportTargetLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <FormButton type="submit" variant="secondary" className="w-auto">
        Apply filters
      </FormButton>
    </form>
  );
}

// The reports of a status and a kind in the order the database gives: the open ones fee demands first, then by due time
// (FR-S1 AC3, decision 7.2), so that none waits behind newer ones. Only the title of a vacancy, the name of a company or
// a path is shown, never the text of the report.
export async function ReportQueue({ lang, filter, after }: { lang: string; filter: ReportListFilter; after: ReportQueueCursor | null }) {
  const page = await listReports(filter, after);
  const query = new URLSearchParams({ status: filter.status, ...(filter.type ? { type: filter.type } : {}) });

  return (
    <div className="grid gap-4">
      <Filters lang={lang} filter={filter} />
      {page.rows.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={filter.status === "open" && !filter.type && !after ? "No open reports" : "No reports here"}
          description={filter.status === "open" && !filter.type && !after ? "Every report has been decided." : "Nothing matches these filters."}
        />
      ) : (
        <ResultsTable caption="Reports" columns={["Reference", "About", "Category", "Status", "Reported", "First look due"]}>
          {page.rows.map((row) => (
            <tr key={row.id}>
              <td className={cell}>
                <TextLink href={adminPath(lang, `reports/${row.id}`)} className="font-mono">
                  {row.reference}
                </TextLink>
              </td>
              <td className={`${cell} break-words`}>
                {row.targetLabel === reportTargetLabels[row.targetType] ? null : (
                  <span className="text-muted-foreground">{reportTargetLabels[row.targetType]}: </span>
                )}
                {row.targetLabel}
              </td>
              <td className={cell}>
                {isFeeDemand(row.category) ? (
                  <StatusBadge status="danger" className="mb-1">
                    {FEE_DEMAND_LABEL}
                  </StatusBadge>
                ) : null}
                <span className="block">{reportCategoryLabels[row.category]}</span>
              </td>
              <td className={cell}>
                <StatusBadge status={reportStatusTones[row.status]}>{reportStatusLabels[row.status]}</StatusBadge>
              </td>
              <td className={cell}>
                <time dateTime={row.createdAt}>{formatDate(row.createdAt)}</time>
              </td>
              <td className={cell}>
                {row.status === "new" || row.status === "in_review" ? (
                  <>
                    {row.overdue ? <StatusBadge status="danger">Overdue</StatusBadge> : null}
                    <time dateTime={row.dueAt} className="block text-small text-muted-foreground">
                      {formatDateTime(row.dueAt)}
                    </time>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </ResultsTable>
      )}
      {page.next ? (
        <TextLink standalone href={`${adminPath(lang, "reports")}?${query.toString()}&after=${encodeURIComponent(reportQueueCursorParam(page.next))}`}>
          Show more
        </TextLink>
      ) : null}
    </div>
  );
}
