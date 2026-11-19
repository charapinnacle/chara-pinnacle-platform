import type { Metadata } from "next";
import { Scale } from "lucide-react";
import { notFound } from "next/navigation";
import { decisionSubject } from "@/components/appeals/appeal-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { listMyAppeals } from "@/lib/dal/appeals";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { appealPath } from "@/lib/routes";
import { appealStatusLabels, appealStatusTones } from "@/lib/validation/appeal";

export const metadata: Metadata = { title: "Moderation decisions", robots: { index: false } };

// The moderation decisions on the user's organisations that can be appealed and the appeals lodged (FR-S1, DSA Art. 20),
// newest first. Every member reads them; owners and admins appeal from the decision. Release 2a only.
export default async function AppealsPage({ params }: PageProps<"/[lang]/appeals">) {
  const { lang } = await params;
  await requireUser(lang);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const decisions = await listMyAppeals();

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Moderation decisions"
        description="Decisions of our moderators about your organisations, with their reasons. An owner or admin can appeal each one."
      />
      {decisions.length === 0 ? (
        <EmptyState icon={Scale} title="No moderation decisions" description="Nothing of your organisations has been hidden or suspended." />
      ) : (
        <ul className="grid gap-3">
          {decisions.map((decision) => (
            <Card as="li" key={decision.id} className="gap-1">
              <TextLink href={appealPath(lang, decision.id)} className="wrap-anywhere">
                {decisionSubject(decision)}
              </TextLink>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground">
                {decision.appeal ? (
                  <StatusBadge status={appealStatusTones[decision.appeal.status]}>{appealStatusLabels[decision.appeal.status]}</StatusBadge>
                ) : decision.canAppeal ? (
                  <StatusBadge status="info">Can be appealed until {formatDate(decision.appealUntil)}</StatusBadge>
                ) : null}
                <span>
                  {decision.organizationName} · Decided on {formatDate(decision.decidedAt)}
                  {decision.inEffect ? "" : " · No longer in effect"}
                </span>
              </p>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
