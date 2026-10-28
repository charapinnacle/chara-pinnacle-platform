import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { InvitationStatusBadge } from "@/components/invitations/invitation-status";
import { listMyInvitations } from "@/lib/dal/invitations";
import { formatDate } from "@/lib/i18n/format";
import { inboxCountText, inboxQuery, partnerStatusLabels, type InboxParams } from "@/lib/invitations/presentation";
import { workersText } from "@/lib/requirements/presentation";
import { invitationPath, invitationsPath } from "@/lib/routes";

type InvitationInboxProps = { lang: string; slug: string; organizationId: string; params: InboxParams; countries: Map<string, string> };

// One page of the invitations a recruitment or staffing company received, newest first (FR-O1 AC8): each names the
// requirement and the employer (the invitation reveals it, decision 3.2) with its status; destination, workers and
// start date while it is pending, accepted or responded. Reading the list marks nothing seen.
export async function InvitationInbox({ lang, slug, organizationId, params, countries }: InvitationInboxProps) {
  const { invitations, nextCursor, cursorIgnored } = await listMyInvitations(organizationId, params.status, params.cursor);
  const first = invitationsPath(lang, slug, inboxQuery({ status: params.status, cursor: null }));

  if (invitations.length === 0) {
    return (
      <div role="status">
        {params.status ? (
          <EmptyState icon={Inbox} title={`No invitations with the status ${partnerStatusLabels[params.status]}`}>
            <TextLink standalone href={invitationsPath(lang, slug)}>
              Show all invitations
            </TextLink>
          </EmptyState>
        ) : (
          <EmptyState
            icon={Inbox}
            title="No invitations yet"
            description="Employers invite listed recruitment and staffing companies to their workforce requirements. Your owners and admins are told by email when one arrives."
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {cursorIgnored ? (
        <Notice tone="info" role="status">
          That page no longer exists, so the newest invitations are shown.
        </Notice>
      ) : null}
      <p role="status" aria-live="polite" className="text-body text-muted-foreground">
        {inboxCountText(invitations.length, nextCursor !== null)}
      </p>
      <ul className="divide-y border-y" aria-label="Invitations">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="grid gap-2 py-5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <h2 className="text-h3 min-w-0">
                <TextLink href={invitationPath(lang, slug, invitation.id)} className="break-words">
                  {invitation.title}
                </TextLink>
              </h2>
              <InvitationStatusBadge status={invitation.status} view="partner" />
            </div>
            <p className="text-body break-words">{invitation.employerName}</p>
            {invitation.countryCode && invitation.workersNeeded !== null ? (
              <p className="text-small text-muted-foreground">
                {countries.get(invitation.countryCode) ?? invitation.countryCode} · {workersText(invitation.workersNeeded)}
                {invitation.startDate ? (
                  <>
                    {" "}
                    · Starts <time dateTime={invitation.startDate}>{formatDate(invitation.startDate)}</time>
                  </>
                ) : null}
              </p>
            ) : null}
            <p className="text-small text-muted-foreground">
              Invited <time dateTime={invitation.invitedAt}>{formatDate(invitation.invitedAt)}</time>
            </p>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {nextCursor ? (
          <TextLink standalone href={invitationsPath(lang, slug, inboxQuery({ status: params.status, cursor: nextCursor }))}>
            Show more invitations
          </TextLink>
        ) : null}
        {params.cursor ? (
          <TextLink standalone href={first}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
