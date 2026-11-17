import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppealState } from "@/components/appeals/appeal-state";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { DetailList } from "@/components/layout/detail-list";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { listMyAppeals } from "@/lib/dal/appeals";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { appealPath, appealsPath, mfaPath } from "@/lib/routes";
import { appealableDecisionLabel, appealTargetLabels, idParam } from "@/lib/validation/appeal";

export const metadata: Metadata = { title: "Moderation decision", robots: { index: false } };

// One moderation decision on an organisation of the user, or on a message the user sent as a candidate (V73), with its
// statement of reasons and its appeal (FR-S1 AC12, DSA Art. 17 and 20): the notices of the decision link here. An owner
// or admin, or the member who sent a hidden message, appeals at aal2, as on every organisation page; a candidate appeals
// the own message without it; a member reads the decision and the state of the appeal. A decision that is not theirs is not
// found. A suspended organisation reaches its suspension here too. Release 2a only.
export default async function AppealPage({ params }: PageProps<"/[lang]/appeals/[id]">) {
  const { lang, id } = await params;
  const user = await requireUser(lang);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const decisionId = idParam(id);
  if (decisionId === null) notFound();
  const decision = await listMyAppeals(decisionId);
  if (!decision) notFound();
  if (decision.canAppeal && decision.organizationId && user.aal !== "aal2") redirect(mfaPath(lang, appealPath(lang, decisionId)));

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title={appealableDecisionLabel(decision.action, decision.targetType)}
        description={decision.title}
        breadcrumb={<Breadcrumbs items={[{ label: "Moderation decisions", href: appealsPath(lang) }, { label: decision.title }]} />}
      />
      <Section id="decision" title="The decision">
        <DetailList
          items={[
            { label: appealTargetLabels[decision.targetType] ?? "About", value: decision.title },
            ...(decision.organizationName ? [{ label: "Organisation", value: decision.organizationName }] : []),
            { label: "Decided on", value: formatDate(decision.decidedAt) },
            { label: "Statement of reasons", value: <p className="whitespace-pre-line wrap-anywhere">{decision.reasons}</p> },
          ]}
        />
      </Section>
      <Section id="appeal" title="Appeal">
        <AppealState decision={decision} />
      </Section>
    </div>
  );
}
