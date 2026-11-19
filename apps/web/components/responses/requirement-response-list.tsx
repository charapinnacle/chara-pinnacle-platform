import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { ResponseStatusBadge } from "@/components/responses/response-status";
import type { RequirementResponse } from "@/lib/dal/responses";
import { formatDate } from "@/lib/i18n/format";
import { feeText, workersOfferedText } from "@/lib/responses/presentation";
import { requirementInvitationsPath, requirementPartnersPath, requirementPath, requirementResponsePath } from "@/lib/routes";

type RequirementResponseListProps = { lang: string; slug: string; requirementId: string; responses: RequirementResponse[] };

// The responses to one requirement, oldest first (FR-O2 steps Submit and Edit, AC9; FR-N2 AC9): each partner's name,
// whether it came through an invitation, the status with Updated until the edit is opened, the workers, the date and
// the fee; a withdrawn response shows the date and the reason and offers nothing to decide.
export function RequirementResponseList({ lang, slug, requirementId, responses }: RequirementResponseListProps) {
  if (responses.length === 0) {
    return (
      <EmptyState icon={Inbox} title="No responses yet" description="Partners you invite, and partners that see this requirement on the job order marketplace, respond here.">
        <span className="flex flex-wrap justify-center gap-x-6">
          <TextLink standalone href={requirementPartnersPath(lang, slug, requirementId)}>
            Invite partners
          </TextLink>
          <TextLink standalone href={requirementInvitationsPath(lang, slug, requirementId)}>
            See invitations
          </TextLink>
          <TextLink standalone href={requirementPath(lang, slug, requirementId)}>
            See the job order status
          </TextLink>
        </span>
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-3" aria-label="Responses">
      {responses.map((response) => (
        <Card as="li" key={response.id} className="gap-2">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <h2 className="text-h3 min-w-0 break-words">
              <TextLink href={requirementResponsePath(lang, slug, requirementId, response.id)}>{response.partnerName}</TextLink>
            </h2>
            <ResponseStatusBadge status={response.status} view="employer" updatedUnseen={response.updatedUnseen} />
          </div>
          <p className="text-small text-muted-foreground">{response.invitationId ? "Invited partner" : "From the job order marketplace"}</p>
          {response.status === "withdrawn" ? (
            <>
              <p className="text-body">
                Withdrawn{" "}
                {response.withdrawnAt ? <time dateTime={response.withdrawnAt}>{formatDate(response.withdrawnAt)}</time> : null}
              </p>
              <p className="text-body break-words whitespace-pre-line">
                {response.withdrawalReason ? `Reason: ${response.withdrawalReason}` : "No reason given."}
              </p>
            </>
          ) : (
            <p className="text-body">
              {workersOfferedText(response.capacity)} from <time dateTime={response.availableFrom}>{formatDate(response.availableFrom)}</time> ·{" "}
              {feeText(response.feeModel, response.feeAmount, response.feeCurrency)}
            </p>
          )}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-small text-muted-foreground">
            <span>
              Received <time dateTime={response.createdAt}>{formatDate(response.createdAt)}</time>
            </span>
            {response.version > 1 ? (
              <span>
                Version {response.version}, changed <time dateTime={response.updatedAt}>{formatDate(response.updatedAt)}</time>
              </span>
            ) : null}
          </p>
        </Card>
      ))}
    </ul>
  );
}
