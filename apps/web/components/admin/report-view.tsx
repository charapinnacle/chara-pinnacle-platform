import { notFound } from "next/navigation";
import { JobModerationBadge } from "@/components/admin/job-moderation-badge";
import { ReportDecision } from "@/components/admin/report-decision";
import { AccountStatusBadge } from "@/components/admin/account-status-badge";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { DetailList } from "@/components/layout/detail-list";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { getReport, type ReportDetail } from "@/lib/dal/admin-reports";
import { formatDateTime } from "@/lib/i18n/format";
import { defaultLocale } from "@/lib/i18n/locale";
import { statusLabels } from "@/lib/jobs/presentation";
import { adminPath } from "@/lib/routes";
import { isPrivatePath } from "@/lib/seo/private-routes";
import { reportCategoryLabels, reportStatusLabels, reportStatusTones, reportTargetLabels } from "@/lib/validation/report";

// The path was typed by a visitor, so it is a link only when it is a public page of the site: a staff member's click carries
// their session, and it must never reach a page that acts (a checkout, an export) or one for signed-in people.
function isPublicPage(path: string): boolean {
  return path.split("/")[1] === defaultLocale && !isPrivatePath(path);
}

function Target({ lang, report, canAct }: { lang: string; report: ReportDetail; canAct: boolean }) {
  const { job, organization } = report;
  if (report.targetType === "content" && report.contentPath) {
    return (
      <DetailList
        items={[
          {
            label: "Page",
            value: isPublicPage(report.contentPath) ? (
              <TextLink href={report.contentPath}>{report.contentPath}</TextLink>
            ) : (
              <span className="font-mono wrap-anywhere">{report.contentPath}</span>
            ),
          },
        ]}
      />
    );
  }
  if (report.targetType === "profile") {
    return (
      <div className="grid gap-3">
        <DetailList
          items={[
            { label: "Vacancy applied to", value: job?.title ?? "Not available" },
            { label: "Organisation", value: organization?.name ?? "Not available" },
          ]}
        />
        <p className="text-body text-muted-foreground">
          The name of the candidate and the documents are not shown to staff. The report holds the application only.
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <DetailList
        items={[
          ...(job && report.targetType === "job"
            ? [
                { label: "Vacancy", value: job.title },
                { label: "Status", value: statusLabels[job.status] },
                { label: "Visibility", value: <JobModerationBadge state={job.moderationState} /> },
              ]
            : []),
          ...(organization
            ? [
                { label: "Organisation", value: organization.name },
                { label: "Organisation status", value: <AccountStatusBadge status={organization.status} /> },
              ]
            : []),
        ]}
      />
      <div className="flex flex-wrap gap-x-6">
        {organization ? (
          <TextLink standalone href={adminPath(lang, `organizations/${organization.id}`)}>
            Open the organisation to suspend or reinstate it
          </TextLink>
        ) : null}
        {job && canAct ? (
          <TextLink standalone href={adminPath(lang, `moderation/${job.id}`)}>
            Open the vacancy to hide or unhide it
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}

export async function ReportView({ lang, id, canAct }: { lang: string; id: number; canAct: boolean }) {
  const report = await getReport(id);
  if (!report) notFound();

  return (
    <div className="grid gap-page">
      <PageHeader title={`Report ${report.reference}`}>
        <TextLink standalone href={adminPath(lang, "reports")}>
          Back to the reports
        </TextLink>
      </PageHeader>
      <Section id="report" title="Report" description="As the reporter wrote it.">
        <DetailList
          items={[
            { label: "About", value: reportTargetLabels[report.targetType] },
            { label: "Category", value: reportCategoryLabels[report.category] },
            { label: "Status", value: <StatusBadge status={reportStatusTones[report.status]}>{reportStatusLabels[report.status]}</StatusBadge> },
            { label: "Reported", value: formatDateTime(report.createdAt) },
            {
              label: "Reporter",
              value:
                report.reporterKind === "account"
                  ? "A signed-in account"
                  : report.reporterEmail
                    ? `A visitor, ${report.reporterEmail}`
                    : "A visitor who gave no email",
            },
            { label: "Text", value: <p className="whitespace-pre-line">{report.details}</p> },
          ]}
        />
      </Section>
      <Section id="target" title="What it is about">
        <Target lang={lang} report={report} canAct={canAct} />
      </Section>
      <Section
        id="decision"
        title="Decision"
        description={report.resolutionNote ? undefined : "Hiding a vacancy and suspending an organisation are done with their own controls, linked above. Close the report afterwards."}
      >
        {report.status === "new" || report.status === "in_review" ? (
          canAct ? (
            <ReportDecision id={report.id} status={report.status} reference={report.reference} signedIn={report.reporterKind === "account"} />
          ) : (
            <Notice tone="info" role="status">
              Read only. Trust &amp; Safety decides on reports.
            </Notice>
          )
        ) : (
          <DetailList
            items={[
              { label: "Outcome", value: reportStatusLabels[report.status] },
              { label: "Closed", value: report.handledAt ? formatDateTime(report.handledAt) : "" },
              { label: "Note to the reporter", value: <p className="whitespace-pre-line">{report.resolutionNote}</p> },
            ]}
          />
        )}
      </Section>
    </div>
  );
}
