import { Send } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { InvitationStatusBadge } from "@/components/invitations/invitation-status";
import { WithdrawInvitationButton } from "@/components/invitations/withdraw-invitation-button";
import { Card } from "@/components/layout/card";
import { MessageButton } from "@/components/messaging/message-button";
import type { RequirementInvitation } from "@/lib/dal/invitations";
import { formatDate } from "@/lib/i18n/format";
import { canWithdraw, invitationSourceLabels } from "@/lib/invitations/presentation";
import { criterionTexts } from "@/lib/requirements/suggestions";
import { partnerProfileForPath, requirementResponsePath } from "@/lib/routes";

const typeLabels = { employer: "Employer", recruitment_company: "Recruitment company", staffing_company: "Staffing company" } as const;

function DateLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span>
      {label} <time dateTime={value}>{formatDate(value)}</time>
    </span>
  );
}

type RequirementInvitationListProps = {
  lang: string;
  slug: string;
  requirementId: string;
  invitations: RequirementInvitation[];
  // The response of each responded invitation, by invitation id (FR-O1 AC9: Responded links to it).
  responseOf: Readonly<Record<string, string>>;
  canManage: boolean;
  // Set while release 2c is on: an accepted or answered invitation offers Message (FR-P1).
  messaging: boolean;
  // Where an empty list leads: the directory, and the suggestions when the requirement has them.
  findPartnersHref: string;
  suggestionsHref: string | null;
};

// The partners invited to one requirement with the status of each (FR-O1 step Track, AC9): the name (a link to the
// profile while the partner is listed), the status in words with its dates, the decline reason, where the employer
// chose the partner and the criteria it met then (FR-M3 AC9), and Withdraw before a response for an owner or admin.
// Never who invited. A responded invitation links its response; an accepted or answered one offers Message while release 2c
// is on.
export function RequirementInvitationList({
  lang,
  slug,
  requirementId,
  invitations,
  responseOf,
  canManage,
  messaging,
  findPartnersHref,
  suggestionsHref,
}: RequirementInvitationListProps) {
  if (invitations.length === 0) {
    return (
      <EmptyState icon={Send} title="No partners invited yet" description="Invite recruitment and staffing companies from the directory, a partner profile or the suggestions for this requirement.">
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <TextLink standalone href={findPartnersHref}>
            Find partners
          </TextLink>
          {suggestionsHref ? (
            <TextLink standalone href={suggestionsHref}>
              Suggested partners
            </TextLink>
          ) : null}
        </div>
      </EmptyState>
    );
  }

  return (
    <ul className="grid gap-3" aria-label="Invited partners">
      {invitations.map((invitation) => {
        const messageable = messaging && (invitation.status === "accepted" || invitation.status === "responded");
        const withdrawable = canManage && canWithdraw(invitation.status);
        return (
          <Card as="li" key={invitation.id} className="gap-2">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="grid min-w-0 gap-1">
                <h2 className="text-h3 break-words">
                  {invitation.partnerSlug ? (
                    <TextLink href={partnerProfileForPath(lang, invitation.partnerSlug, slug)}>{invitation.partnerName}</TextLink>
                  ) : (
                    invitation.partnerName
                  )}
                </h2>
                <p className="text-small text-muted-foreground">{typeLabels[invitation.partnerType]}</p>
              </div>
              <InvitationStatusBadge status={invitation.status} view="employer" />
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-small text-muted-foreground">
              <DateLine label="Invited" value={invitation.invitedAt} />
              <DateLine label="Seen" value={invitation.viewedAt} />
              <DateLine label="Answered" value={invitation.answeredAt} />
              <DateLine label="Responded" value={invitation.respondedAt} />
              <DateLine label="Withdrawn" value={invitation.withdrawnAt} />
              <DateLine label="Expired" value={invitation.expiredAt} />
            </p>
            {invitation.status === "responded" && responseOf[invitation.id] ? (
              <p>
                <TextLink href={requirementResponsePath(lang, slug, requirementId, responseOf[invitation.id])}>
                  See the response<span className="sr-only"> of {invitation.partnerName}</span>
                </TextLink>
              </p>
            ) : null}
            {invitation.status === "declined" ? (
              <p className="text-body break-words whitespace-pre-line">
                {invitation.declineReason ? `Reason: ${invitation.declineReason}` : "No reason given."}
              </p>
            ) : null}
            <p className="text-small text-muted-foreground">
              {invitationSourceLabels[invitation.source]}
              {invitation.suggestionCriteria && invitation.suggestionCriteria.length > 0
                ? `. Criteria met then: ${invitation.suggestionCriteria.map((criterion) => criterionTexts[criterion].met.toLowerCase()).join("; ")}.`
                : null}
            </p>
            {messageable || withdrawable ? (
              <div className="flex flex-wrap gap-2">
                {messageable ? (
                  <MessageButton contextType="requirement_invitation" contextId={invitation.id} slug={slug} recipient={invitation.partnerName} />
                ) : null}
                {withdrawable ? (
                  <WithdrawInvitationButton slug={slug} requirementId={requirementId} invitationId={invitation.id} partnerName={invitation.partnerName} />
                ) : null}
              </div>
            ) : null}
          </Card>
        );
      })}
    </ul>
  );
}
