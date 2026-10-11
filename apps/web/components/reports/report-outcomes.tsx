import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { listMyReports } from "@/lib/dal/reports";
import { formatDate } from "@/lib/i18n/format";
import { myReportsPath } from "@/lib/routes";
import { reportStatusLabels } from "@/lib/validation/report";

const RECENT_DAYS = 14;

// The notice on the dashboard of a signed-in reporter whose report was closed in the last two weeks: the outcome and the
// note, which is how Trust & Safety tell them. It shows nothing otherwise, and nothing when the reports cannot be read, so
// that a failure here never takes the dashboard with it.
export async function ReportOutcomes({ lang }: { lang: string }) {
  const since = new Date().getTime() - RECENT_DAYS * 86_400_000;
  let closed;
  try {
    const { reports } = await listMyReports(null);
    closed = reports.filter((report) => report.resolutionNote && report.handledAt && Date.parse(report.handledAt) >= since);
  } catch (error) {
    console.error("The closed reports could not be read for the dashboard", { cause: error instanceof Error ? error.cause : undefined });
    return null;
  }
  if (closed.length === 0) return null;

  return (
    <Notice tone="info" role="status" aria-label="Your closed reports">
      <ul className="grid gap-2">
        {closed.map((report) => (
          <li key={report.id} className="grid gap-0.5">
            <p>
              Your report <span className="font-mono font-medium">{report.reference}</span> was closed as{" "}
              <strong>{reportStatusLabels[report.status].toLowerCase()}</strong> on {formatDate(report.handledAt ?? report.createdAt)}.
            </p>
            <p className="wrap-anywhere whitespace-pre-line">{report.resolutionNote}</p>
          </li>
        ))}
      </ul>
      <TextLink href={myReportsPath(lang)} className="mt-2">
        See your reports
      </TextLink>
    </Notice>
  );
}
