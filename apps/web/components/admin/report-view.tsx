import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { JobModerationBadge } from "@/components/admin/job-moderation-badge";
import { ReportPartnerDetails } from "@/components/admin/partner-moderation-details";
import { ReportDecision, type DecisionTarget } from "@/components/admin/report-decision";
import { ReportedMessageContext } from "@/components/admin/reported-message";
import { AccountStatusBadge } from "@/components/admin/account-status-badge";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { DetailList } from "@/components/layout/detail-list";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { getReport, type ReportDetail, type ReportItemContext } from "@/lib/dal/admin-reports";
import { feeText } from "@/lib/responses/presentation";
import { partnerSubmissionLabels } from "@/lib/submissions/presentation";
import { isReleased } from "@/lib/dal/release";
import { formatDateTime } from "@/lib/i18n/format";
import { defaultLocale } from "@/lib/i18n/locale";
import { statusLabels } from "@/lib/jobs/presentation";
import { adminPath, partnerProfilePath } from "@/lib/routes";
import { isPrivatePath } from "@/lib/seo/private-routes";
import {
  closesWithNote,
  decidedAfterReading,
  FEE_DEMAND_LABEL,
  isFeeDemand,
  isReportItem,
  reportCategoryLabels,
  reportDecisionLabel,
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

// What staff read of a job order, response or submission to decide on it: the text its organisation wrote and its state.
// A submission shows the partner's note and stage only; the candidate is never shown to staff.
function itemDetails(report: ReportDetail): { label: string; value: ReactNode }[] {
  const context: ReportItemContext = report.item?.context ?? {};
  const text = (value: string | null | undefined) => <p className="whitespace-pre-line wrap-anywhere">{value ?? ""}</p>;
  const rows: { label: string; value: ReactNode }[] = [];
  if (report.targetType === "requirement") {
    rows.push({ label: "Job order", value: context.title ?? "Not available" });
    if (context.workers_needed !== undefined) rows.push({ label: "Workers", value: String(context.workers_needed) });
    if (context.country_code) rows.push({ label: "Destination", value: [context.city_region, context.country_code].filter(Boolean).join(", ") });
    if (context.skills) rows.push({ label: "Skills", value: text(context.skills) });
  } else {
    rows.push({ label: "Job order", value: context.requirement_title ?? "Not available" });
  }
  if (report.targetType === "partner_response") {
    if (context.capacity !== undefined) rows.push({ label: "Capacity", value: String(context.capacity) });
    if (context.experience_note) rows.push({ label: "Experience", value: text(context.experience_note) });
    if (context.timeline_note) rows.push({ label: "Timeline", value: text(context.timeline_note) });
    if (context.fee_model) rows.push({ label: "Fee", value: feeText(context.fee_model, context.fee_amount ?? null, context.fee_currency ?? null) });
    if (context.notes) rows.push({ label: "Notes", value: text(context.notes) });
  }
  if (report.targetType === "candidate_submission") {
    const stage = context.status;
    if (stage && stage in partnerSubmissionLabels) rows.push({ label: "Stage", value: partnerSubmissionLabels[stage as keyof typeof partnerSubmissionLabels] });
    if (context.note) rows.push({ label: "Partner's note", value: text(context.note) });
  }
  if (report.item?.moderationState) rows.push({ label: "Visibility", value: <JobModerationBadge state={report.item.moderationState} /> });
  return rows;
}

// A message or a contact request: who sent it and its state with the page; its text only on the handler's audited
// opening (NFR-C5).
function SentItem({ report, canAct }: { report: ReportDetail; canAct: boolean }) {
  const { organization } = report;
  const kind = report.targetType === "contact_request" ? "contact_request" : "message";
  const context: ReportItemContext = report.item?.context ?? {};
  const details: { label: string; value: ReactNode }[] = [
    { label: "Sent by", value: organization?.name ?? "A candidate" },
    ...(organization ? [{ label: "Organisation status", value: <AccountStatusBadge status={organization.status} /> }] : []),
    ...(kind === "contact_request" ? [{ label: "Vacancy offered", value: context.job_title ?? "None" }] : []),
    ...(report.item?.moderationState ? [{ label: "Visibility", value: <JobModerationBadge state={report.item.moderationState} /> }] : []),
  ];
  return (
    <div className="grid gap-4">
      <DetailList items={details} />
      {canAct && report.status === "in_review" ? (
        <ReportedMessageContext reportId={report.id} kind={kind} />
      ) : (
        <p className="text-body text-muted-foreground">
          {kind === "contact_request" ? "The text of the contact request" : "The text of the message"} is shown only to the
          Trust &amp; Safety Administrator who puts this report in review, and every opening is recorded.
        </p>
      )}
    </div>
  );
}

function Target({ lang, report, canAct }: { lang: string; report: ReportDetail; canAct: boolean }) {
  const { job, organization } = report;
  if (report.targetType === "message" || report.targetType === "contact_request") return <SentItem report={report} canAct={canAct} />;
  if (isReportItem(report.targetType)) {
    return (
      <div className="grid gap-3">
        <DetailList
          items={[
            ...itemDetails(report),
            ...(organization
              ? [
                  { label: "Organisation", value: organization.name },
                  { label: "Organisation status", value: <AccountStatusBadge status={organization.status} /> },
                ]
              : []),
          ]}
        />
        {report.targetType === "candidate_submission" ? (
          <p className="text-body text-muted-foreground">The candidate is not shown to staff. The report holds the submission only.</p>
        ) : null}
        {organization ? (
          <TextLink standalone href={adminPath(lang, `organizations/${organization.id}`)}>
            Open the organisation
          </TextLink>
        ) : null}
      </div>
    );
  }
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
  if (report.targetType === "message") return { kind, title: "A message in a conversation", organization };
  if (report.targetType === "contact_request") {
    return { kind, title: report.item?.context.job_title ?? "A contact request without a vacancy", organization };
  }
  if (report.targetType === "requirement") return { kind, title: report.item?.context.title ?? "Not available", organization };
  if (report.targetType === "partner_response" || report.targetType === "candidate_submission") {
    return { kind, title: report.item?.context.requirement_title ?? "Not available", organization };
  }
  return { kind, title: report.targetType === "profile" ? "The candidate is not shown to staff" : (organization ?? "Not available"), organization };
}

export async function ReportView({ lang, id, canAct }: { lang: string; id: number; canAct: boolean }) {
  const [report, released] = await Promise.all([getReport(id), isReleased("release_partner_directories")]);
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
                    label: "First look due",
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
            : released
              ? "Hide the item, suspend its organisation or dismiss the report, with a statement of reasons. The report is closed with the decision."
              : "Hiding a vacancy and suspending an organisation are done with their own controls, linked above. Close the report afterwards."
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
              decisions={
                released && !(decidedAfterReading(report.targetType) && report.status === "new") ? reportDecisionsFor(report) : []
              }
              closeWithNote={!released || closesWithNote(report.targetType)}
              dismissWithNote={!released}
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
              ...(report.decision ? [{ label: "Decision", value: reportDecisionLabel(report.decision, report.targetType) }] : []),
              { label: "Closed", value: report.handledAt ? formatDateTime(report.handledAt) : "" },
              { label: "Statement of reasons", value: <p className="whitespace-pre-line">{report.resolutionNote}</p> },
            ]}
          />
        )}
      </Section>
    </div>
  );
}
