import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import type { MyCard } from "@/lib/dal/worker-visibility";
import { formatDate } from "@/lib/i18n/format";
import { findWorkersCardPath } from "@/lib/routes";

type FindWorkersCardProps = { lang: string; card: MyCard };

// The state of the worker's Find Workers card on the dashboard (FR-Q1 AC10; NFR-U4): visible or not, and the next step.
export function FindWorkersCard({ lang, card }: FindWorkersCardProps) {
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
    </Card>
  );
}
