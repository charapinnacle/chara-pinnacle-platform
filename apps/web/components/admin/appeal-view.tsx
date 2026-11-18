import { notFound } from "next/navigation";
import { AppealDecision } from "@/components/admin/appeal-decision";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { DetailList } from "@/components/layout/detail-list";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { getAppeal, type AppealDetail } from "@/lib/dal/admin-appeals";
import { formatDateTime } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import { appealableDecisionLabel, appealStatusLabels, appealStatusTones, appealTargetLabels, NO_ORGANIZATION } from "@/lib/validation/appeal";

// What a reversal undoes, as the dialog says it; a decision no longer in effect has nothing left to undo.
const undoText: Record<string, string> = {
  content_hidden: "The partner profile is shown again, unless the partner is suspended.",
  job_hidden: "The vacancy is shown again, unless its organisation is suspended.",
  organization_suspended: "The organisation is reinstated: its vacancies and partner profile come back and its team can act again.",
};

// Why a decision is no longer in effect, for what it is about: only a vacancy can also have been deleted since.
export function notInEffectWhy(appeal: Pick<AppealDetail, "targetType">): string {
  return appeal.targetType === "job" ? "a later decision changed it, or the vacancy was deleted" : "a later decision changed it";
}

export function undoOf(appeal: AppealDetail): string {
  if (!appeal.inEffect) {
    return `The decision is no longer in effect (${notInEffectWhy(appeal)}), so nothing is undone; the outcome is recorded and sent.`;
  }
  return undoText[appeal.action] ?? "What the decision took away is restored.";
}

function targetLink(lang: string, appeal: AppealDetail) {
  if (appeal.targetType === "job") return <TextLink href={adminPath(lang, `moderation/${appeal.targetId}`)}>Open the vacancy</TextLink>;
  if (!appeal.organizationId) return null;
  return <TextLink href={adminPath(lang, `organizations/${appeal.organizationId}`)}>Open the organisation</TextLink>;
}

// One appeal with the decision it is about (FR-S1 AC9, AC11): Trust & Safety decide it unless they took the decision; the
// Platform Administrator reads it. Never the name of the appellant.
export async function AppealView({ lang, id, canAct }: { lang: string; id: number; canAct: boolean }) {
  const appeal = await getAppeal(id);
  if (!appeal) notFound();
  const subject = `${appealableDecisionLabel(appeal.action, appeal.targetType)}: ${appeal.title}`;

  return (
    <div className="grid gap-page">
      <PageHeader title={`Appeal A-${String(appeal.id).padStart(6, "0")}`}>
        <TextLink standalone href={adminPath(lang, "appeals")}>
          Back to the appeals
        </TextLink>
      </PageHeader>
      <Section id="decision" title="The decision" description="As it was sent to the organisation.">
        <DetailList
          items={[
            { label: "Decision", value: appealableDecisionLabel(appeal.action, appeal.targetType) },
            { label: appealTargetLabels[appeal.targetType] ?? "About", value: appeal.title },
            { label: "Organisation", value: appeal.organizationName ?? NO_ORGANIZATION },
            { label: "Decided", value: formatDateTime(appeal.decidedOn) },
            { label: "Statement of reasons", value: <p className="whitespace-pre-line wrap-anywhere">{appeal.decisionReasons}</p> },
            ...(appeal.decisionReportId
              ? [{ label: "Report", value: <TextLink href={adminPath(lang, `reports/${appeal.decisionReportId}`)}>Open the report</TextLink> }]
              : []),
            { label: "In effect", value: appeal.inEffect ? "Yes" : `No: ${notInEffectWhy(appeal)}` },
          ]}
        />
        <div>{targetLink(lang, appeal)}</div>
      </Section>
      <Section id="appeal" title="Appeal" description="As the owner or an admin of the organisation wrote it.">
        <DetailList
          items={[
            { label: "Status", value: <StatusBadge status={appealStatusTones[appeal.status]}>{appealStatusLabels[appeal.status]}</StatusBadge> },
            { label: "Lodged", value: formatDateTime(appeal.lodgedAt) },
            ...(appeal.status === "open"
              ? [
                  {
                    label: "Due",
                    value: (
                      <>
                        {appeal.overdue ? (
                          <StatusBadge status="danger" className="me-2">
                            Overdue
                          </StatusBadge>
                        ) : null}
                        <time dateTime={appeal.dueAt}>{formatDateTime(appeal.dueAt)}</time>
                      </>
                    ),
                  },
                ]
              : []),
            { label: "Grounds", value: <p className="whitespace-pre-line wrap-anywhere">{appeal.grounds}</p> },
          ]}
        />
      </Section>
      <Section
        id="outcome"
        title="Outcome"
        description={appeal.status === "open" ? "A Trust & Safety administrator who did not take the decision upholds or reverses it, with a statement of reasons." : undefined}
      >
        {appeal.status !== "open" ? (
          <DetailList
            items={[
              { label: "Result", value: appealStatusLabels[appeal.status] },
              { label: "Decided", value: appeal.decidedAt ? formatDateTime(appeal.decidedAt) : "" },
              { label: "Statement of reasons", value: <p className="whitespace-pre-line wrap-anywhere">{appeal.reasons}</p> },
            ]}
          />
        ) : !canAct ? (
          <Notice tone="info" role="status">
            Read only. Trust &amp; Safety decide on appeals.
          </Notice>
        ) : appeal.ownDecision ? (
          <Notice tone="info" role="status">
            You took this decision, so another Trust &amp; Safety administrator decides the appeal.
          </Notice>
        ) : (
          <AppealDecision id={appeal.id} subject={subject} undo={undoOf(appeal)} />
        )}
      </Section>
    </div>
  );
}
