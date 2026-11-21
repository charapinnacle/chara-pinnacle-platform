import { BlockCard, Figure } from "@/components/dashboard/block-card";
import { TextLink } from "@/components/forms/text-link";
import {
  matchingWorkersText,
  partnerRequestLines,
  unavailableTexts,
  type EmployerRequests,
  type MatchingAudience,
  type MatchingWorkers,
  type PartnerRequests,
} from "@/lib/dashboard/connections";
import { formatCount } from "@/lib/i18n/format";
import { invitationsPath, messagesPath } from "@/lib/routes";

type Place = { lang: string; slug: string };

// The unread messages of the organisation's conversations (FR-R3, FR-R4, FR-R5 release 2c; NFR-U4), read with the page.
// An owner or admin at aal1 reads no conversation of the organisation (V63), so the block says what opens it.
export function UnreadMessagesCard({ unread, lang, slug, lockedHref }: Place & { unread: number; lockedHref: string | null }) {
  const inbox = messagesPath(lang, slug);
  if (lockedHref) {
    return (
      <BlockCard id="unread-messages-heading" title="Unread messages">
        <p className="text-body text-muted-foreground">Owners and admins read the messages of the company after the two-step check.</p>
        <TextLink standalone href={lockedHref}>
          Complete the two-step check
        </TextLink>
      </BlockCard>
    );
  }
  return (
    <BlockCard id="unread-messages-heading" title="Unread messages">
      {unread === 0 ? (
        <p className="text-body text-muted-foreground">
          No unread messages. Conversations start from applications, invitations, responses and inquiries.
        </p>
      ) : (
        <dl>
          <Figure label="Unread messages">
            <span className="text-figure tabular-nums">{formatCount(unread)}</span>
          </Figure>
        </dl>
      )}
      <TextLink standalone href={inbox}>
        {unread === 0 ? "Open your messages" : unread === 1 ? "Read the unread message" : "Read the unread messages"}
      </TextLink>
    </BlockCard>
  );
}

type MatchingWorkersProps = {
  value: MatchingWorkers;
  audience: MatchingAudience;
  findWorkersHref: string;
  // Where the plan is changed, for the owner and admins; null for a member.
  billingHref: string | null;
};

// The number of workers who chose to be visible and fit the organisation (FR-R5 AC5, AC6): never a name, photo or card.
// Without the right to search the block says why, with the way to a paid plan for those who choose it.
export function MatchingWorkersCard({ value, audience, findWorkersHref, billingHref }: MatchingWorkersProps) {
  if (value.kind === "unavailable") {
    const upgrade = value.reason === "feature_not_in_plan";
    return (
      <BlockCard id="matching-workers-heading" title="Matching workers">
        <p className="text-body text-muted-foreground">{unavailableTexts[value.reason]}</p>
        {upgrade && billingHref ? (
          <TextLink standalone href={billingHref}>
            Upgrade your plan
          </TextLink>
        ) : upgrade ? (
          <p className="text-small text-muted-foreground">Ask an owner or admin of your company to upgrade.</p>
        ) : null}
      </BlockCard>
    );
  }
  return (
    <BlockCard id="matching-workers-heading" title="Matching workers">
      {value.kind === "count" && value.count > 0 ? (
        <dl>
          <Figure label="Visible workers who match">
            <span className="text-figure tabular-nums">{formatCount(value.count)}</span>
          </Figure>
        </dl>
      ) : null}
      <p className={value.kind === "count" && value.count > 0 ? "text-small text-muted-foreground" : "text-body text-muted-foreground"}>
        {matchingWorkersText(value, audience)}
      </p>
      <TextLink standalone href={findWorkersHref}>
        Find workers
      </TextLink>
    </BlockCard>
  );
}

// The inquiries and workforce requests employers sent the company that wait for its answer (FR-R4 AC6). A workforce
// request is answered from its invitation, an inquiry in its conversation.
export function PartnerRequestsCard({ requests, lang, slug }: Place & { requests: PartnerRequests }) {
  const lines = partnerRequestLines(requests);
  const inquiriesHref = messagesPath(lang, slug, { context: "inquiry" });
  return (
    <BlockCard id="partner-requests-heading" title="Partner requests">
      {lines.length === 0 ? (
        <>
          <p className="text-body text-muted-foreground">
            No inquiries or workforce requests wait for your answer. Employers send them from your public profile.
          </p>
          <TextLink standalone href={inquiriesHref}>
            See your inquiries
          </TextLink>
        </>
      ) : (
        <>
          <dl className="grid gap-3">
            {lines.map((line) => (
              <Figure key={line.key} label={`${line.label} waiting for your answer`}>
                {formatCount(line.count)}
              </Figure>
            ))}
          </dl>
          {requests.inquiries > 0 ? (
            <TextLink standalone href={inquiriesHref}>
              {requests.inquiries === 1 ? "Answer the inquiry" : "Answer the inquiries"}
            </TextLink>
          ) : null}
          {requests.total > requests.inquiries ? (
            <TextLink standalone href={invitationsPath(lang, slug)}>
              Respond to request
            </TextLink>
          ) : null}
        </>
      )}
    </BlockCard>
  );
}

// The employer's own inquiries and workforce requests to partners: those still waiting and those answered.
export function EmployerRequestsCard({ requests, lang, slug, findPartnersHref }: Place & { requests: EmployerRequests; findPartnersHref: string }) {
  const empty = requests.waiting === 0 && requests.answered === 0;
  return (
    <BlockCard id="employer-requests-heading" title="Inquiries and workforce requests">
      {empty ? (
        <>
          <p className="text-body text-muted-foreground">Send an inquiry or request workforce from a partner&apos;s profile.</p>
          <TextLink standalone href={findPartnersHref}>
            Find partners
          </TextLink>
        </>
      ) : (
        <>
          <dl className="grid gap-3">
            {requests.waiting > 0 ? <Figure label="Waiting for the partner's answer">{formatCount(requests.waiting)}</Figure> : null}
            {requests.answered > 0 ? <Figure label="Answered by the partner">{formatCount(requests.answered)}</Figure> : null}
          </dl>
          <TextLink standalone href={messagesPath(lang, slug)}>
            {requests.answered > 0 ? "Read the partners' answers" : "See your conversations"}
          </TextLink>
        </>
      )}
    </BlockCard>
  );
}
