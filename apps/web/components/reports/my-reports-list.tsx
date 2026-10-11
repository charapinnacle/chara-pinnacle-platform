import { StatusBadge } from "@/components/feedback/status-badge";
import { Card } from "@/components/layout/card";
import type { MyReport } from "@/lib/dal/reports";
import { formatDate } from "@/lib/i18n/format";
import { reportCategoryLabels, reportStatusLabels, reportStatusTones, reportTargetLabels } from "@/lib/validation/report";

// Each report with its status in words; a closed one also says what was decided and the note of Trust & Safety.
export function MyReportsList({ reports }: { reports: readonly MyReport[] }) {
  return (
    <ul aria-label="Your reports" className="grid gap-3">
      {reports.map((report) => (
        <Card as="li" key={report.id} padding="lg" className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono font-medium">{report.reference}</p>
            <StatusBadge status={reportStatusTones[report.status]}>{reportStatusLabels[report.status]}</StatusBadge>
          </div>
          <p className="wrap-anywhere">
            {report.targetLabel === reportTargetLabels[report.targetType] ? null : (
              <span className="text-muted-foreground">{reportTargetLabels[report.targetType]}: </span>
            )}
            {report.targetLabel}
          </p>
          <p className="text-small text-muted-foreground">
            {reportCategoryLabels[report.category]} · Sent <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
          </p>
          {report.resolutionNote ? (
            <div className="grid gap-0.5 border-t pt-2">
              <p className="text-small text-muted-foreground">
                Note from Trust &amp; Safety{report.handledAt ? ` on ${formatDate(report.handledAt)}` : ""}
              </p>
              <p className="wrap-anywhere whitespace-pre-line">{report.resolutionNote}</p>
            </div>
          ) : null}
        </Card>
      ))}
    </ul>
  );
}
