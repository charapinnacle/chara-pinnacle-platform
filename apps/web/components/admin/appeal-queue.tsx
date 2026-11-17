import { Scale } from "lucide-react";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { FormButton } from "@/components/forms/form-button";
import { NativeSelect } from "@/components/forms/native-select";
import { TextLink } from "@/components/forms/text-link";
import { getAppealStats, listAppeals, type AppealStats } from "@/lib/dal/admin-appeals";
import { formatCount, formatDate, formatDateTime } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import {
  appealCursorParam,
  appealListStatusLabels,
  appealStatusLabels,
  NO_ORGANIZATION,
  appealStatusTones,
  appealTargetLabels,
  reversedShare,
  type AppealCursor,
  type AppealListStatus,
} from "@/lib/validation/appeal";

// The KPI "Decisions reversed on appeal" (FR-S1) over the appeals decided in the last year, with the open ones.
function AppealFigures({ stats }: { stats: AppealStats }) {
  const share = reversedShare(stats.decided, stats.restored);
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {[
        {
          term: "Reversed on appeal (last 12 months)",
          value: share === null ? "No appeal decided yet" : `${share}% (${formatCount(stats.restored)} of ${formatCount(stats.decided)})`,
        },
        { term: "Open appeals", value: formatCount(stats.open) },
        { term: "Overdue", value: formatCount(stats.overdue) },
      ].map(({ term, value }) => (
        <div key={term} className="grid gap-1 rounded-lg border bg-card p-3">
          <dt className="text-small text-muted-foreground">{term}</dt>
          <dd className="text-body font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Filters({ lang, status }: { lang: string; status: AppealListStatus }) {
  return (
    <form action={adminPath(lang, "appeals")} method="get" role="search" aria-label="Filter appeals" className="flex flex-wrap items-end gap-3">
      <div className="grid gap-2 sm:w-64">
        <label htmlFor="appeal-status-filter" className="text-small leading-snug font-medium">
          Status
        </label>
        <NativeSelect id="appeal-status-filter" name="status" defaultValue={status}>
          {Object.entries(appealListStatusLabels).map(([value, label]) => (
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

// The appeals in the order the database gives (FR-S1 AC11): open ones by the time they are due, so that none waits behind
// newer ones, decided ones newest first.
export async function AppealQueue({ lang, status, after }: { lang: string; status: AppealListStatus; after: AppealCursor | null }) {
  const [page, stats] = await Promise.all([listAppeals(status, after), getAppealStats()]);
  return (
    <div className="grid gap-4">
      <AppealFigures stats={stats} />
      <Filters lang={lang} status={status} />
      {page.rows.length === 0 ? (
        <EmptyState
          icon={Scale}
          title={status === "open" && !after ? "No open appeals" : "No appeals here"}
          description={status === "open" && !after ? "Every appeal has been decided." : "Nothing matches this filter."}
        />
      ) : (
        <ResultsTable caption="Appeals" columns={["Appeal", "Decision", "Organisation", "Status", "Lodged", "Due"]}>
          {page.rows.map((row) => (
            <tr key={row.id}>
              <td className={cell}>
                <TextLink href={adminPath(lang, `appeals/${row.id}`)} className="font-mono">
                  {`A-${String(row.id).padStart(6, "0")}`}
                </TextLink>
              </td>
              <td className={`${cell} break-words`}>
                <span className="text-muted-foreground">{appealTargetLabels[row.targetType] ?? row.targetType}: </span>
                {row.title}
              </td>
              <td className={`${cell} break-words`}>{row.organizationName ?? NO_ORGANIZATION}</td>
              <td className={cell}>
                <StatusBadge status={appealStatusTones[row.status]} className="whitespace-nowrap">
                  {appealStatusLabels[row.status]}
                </StatusBadge>
              </td>
              <td className={cell}>
                <time dateTime={row.lodgedAt}>{formatDate(row.lodgedAt)}</time>
              </td>
              <td className={cell}>
                {row.status === "open" ? (
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
        <TextLink standalone href={`${adminPath(lang, "appeals")}?status=${status}&after=${encodeURIComponent(appealCursorParam(page.next))}`}>
          Show more
        </TextLink>
      ) : null}
    </div>
  );
}
