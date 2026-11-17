import { Panel } from "@/components/dashboard/panel";
import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { contactRequestsText, type ContactRequestCounts } from "@/lib/dashboard/connections";
import type { MyCard } from "@/lib/dal/worker-visibility";
import { formatDate } from "@/lib/i18n/format";
import { contactRequestsPath, findWorkersCardPath } from "@/lib/routes";

type FindWorkersCardProps = { lang: string; card: MyCard; requests: Promise<ContactRequestCounts> };

// The contact requests the worker received (FR-Q1 AC10), with the way to answer those that wait. A request that waits
// survives a withdrawal, so it is shown whether or not the card is visible.
function ContactRequestsLine({ lang, counts, visible }: { lang: string; counts: ContactRequestCounts; visible: boolean }) {
  if (!visible && counts.received === 0) return null;
  return (
    <div className="grid gap-1">
      <p className="text-small">{contactRequestsText(counts)}</p>
      {counts.received > 0 ? (
        <TextLink standalone="flush" href={contactRequestsPath(lang)} className="text-small">
          {counts.pending > 0 ? "Answer the contact requests" : "See your contact requests"}
        </TextLink>
      ) : null}
    </div>
  );
}

// The state of the worker's Find Workers card on the dashboard (FR-Q1 AC10; NFR-U4): visible or not, and the next step.
export function FindWorkersCard({ lang, card, requests }: FindWorkersCardProps) {
  const href = findWorkersCardPath(lang);
  return (
    <Card as="section" aria-labelledby="find-workers-heading" padding="lg" elevated className="content-start gap-3">
      <h2 id="find-workers-heading" className="text-h2">
        Find Workers
      </h2>
      {card.visible ? (
        <>
          <p className="flex flex-wrap items-center gap-2 text-body">
            <StatusBadge status="success">Visible in Find Workers</StatusBadge>
          </p>
          {card.confirmBy ? (
            <p className="text-small">Please confirm by {formatDate(card.confirmBy)} that your card should stay visible.</p>
          ) : null}
          <TextLink standalone="flush" href={href} className="text-small">
            {card.confirmBy ? "Confirm or turn off" : "Turn off"}
          </TextLink>
        </>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2 text-body">
            <StatusBadge status="neutral">Not visible in Find Workers</StatusBadge>
          </p>
          <p className="text-small text-muted-foreground">
            {card.optedIn
              ? "Your card is hidden while your account is suspended or being deleted."
              : "Let employers and recruitment companies find your card, without your name."}
          </p>
          <TextLink standalone="flush" href={href} className="text-small">
            Learn more<span className="sr-only"> about Find Workers</span>
          </TextLink>
        </>
      )}
      <Panel promise={requests} errorTitle="Your contact requests could not be counted">
        {(counts) => <ContactRequestsLine lang={lang} counts={counts} visible={card.visible} />}
      </Panel>
    </Card>
  );
}
