import { notFound } from "next/navigation";
import { Suspense } from "react";
import { JobModerationBadge } from "@/components/admin/job-moderation-badge";
import { ReportPartnerDetails } from "@/components/admin/partner-moderation-details";
import { ReportDecision, type DecisionTarget } from "@/components/admin/report-decision";
import { AccountStatusBadge } from "@/components/admin/account-status-badge";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
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
import { adminPath, partnerProfilePath } from "@/lib/routes";
import { isPrivatePath } from "@/lib/seo/private-routes";
import {
  closesWithNote,
  FEE_DEMAND_LABEL,
  isFeeDemand,
  reportCategoryLabels,
  reportDecisionLabels,
  reportDecisionsFor,
  reportStatusLabels,
  reportStatusTones,
  reportTargetLabels,
} from "@/lib/validation/report";

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
          ...(organization?.moderationState
            ? [{ label: "Partner profile", value: <JobModerationBadge state={organization.moderationState} /> }]
            : []),
        ]}
      />
      <div className="flex flex-wrap gap-x-6">
        {organization?.status === "active" && report.targetType === "partner_profile" ? (
          <TextLink standalone href={partnerProfilePath(lang, organization.slug)}>
            Open the public profile
          </TextLink>
        ) : null}
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
      {organization?.moderationState ? (
        <Suspense fallback={<LoadingSkeleton rows={2} />}>
          <ReportPartnerDetails lang={lang} organizationId={organization.id} />
        </Suspense>
      ) : null}
    </div>
  );
}

// What the decision dialog names: the kind and title of the target and the organisation it belongs to.
function decisionTarget(report: ReportDetail): DecisionTarget {
  const kind = reportTargetLabels[report.targetType];
  const organization = report.organization?.name ?? null;
  if (report.targetType === "job") return { kind, title: report.job?.title ?? "Not available", organization };
  if (report.targetType === "content") return { kind, title: report.contentPath ?? "Not available", organization: null };
  return { kind, title: report.targetType === "profile" ? "The candidate is not shown to staff" : (organization ?? "Not available"), organization };
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
            {
              label: "Category",
              value: isFeeDemand(report.category) ? (
                <>
                  <StatusBadge status="danger" className="me-2">
                    {FEE_DEMAND_LABEL}
                  </StatusBadge>
                  {reportCategoryLabels[report.category]}
                </>
              ) : (
                reportCategoryLabels[report.category]
              ),
            },
            { label: "Status", value: <StatusBadge status={reportStatusTones[report.status]}>{reportStatusLabels[report.status]}</StatusBadge> },
            { label: "Reported", value: formatDateTime(report.createdAt) },
            ...(report.status === "new" || report.status === "in_review"
              ? [
                  {
                    label: "Due",
                    value: (
                      <>
                        {report.overdue ? (
                          <StatusBadge status="danger" className="me-2">
                            Overdue
                          </StatusBadge>
                        ) : null}
                        <time dateTime={report.dueAt}>{formatDateTime(report.dueAt)}</time>
                      </>
                    ),
                  },
                  { label: "Decision due", value: <time dateTime={report.decisionDueAt}>{formatDateTime(report.decisionDueAt)}</time> },
                ]
              : []),
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
        description={
          report.resolutionNote
            ? undefined
            : "Hide the item, suspend its organisation or dismiss the report, with a statement of reasons. The report is closed with the decision."
        }
      >
        {report.status === "new" || report.status === "in_review" ? (
          canAct ? (
            <ReportDecision
              id={report.id}
              status={report.status}
              reference={report.reference}
              signedIn={report.reporterKind === "account"}
              target={decisionTarget(report)}
              decisions={reportDecisionsFor(report)}
              closeWithNote={closesWithNote(report.targetType)}
            />
          ) : (
            <Notice tone="info" role="status">
              Read only. Trust &amp; Safety decides on reports.
            </Notice>
          )
        ) : (
          <DetailList
            items={[
              { label: "Outcome", value: reportStatusLabels[report.status] },
              ...(report.decision ? [{ label: "Decision", value: reportDecisionLabels[report.decision] ?? report.decision }] : []),
              { label: "Closed", value: report.handledAt ? formatDateTime(report.handledAt) : "" },
              { label: "Statement of reasons", value: <p className="whitespace-pre-line">{report.resolutionNote}</p> },
            ]}
          />
        )}
      </Section>
    </div>
  );
}
