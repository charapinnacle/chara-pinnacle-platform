import { AppealButton } from "@/components/appeals/appeal-button";
import { StatusBadge } from "@/components/feedback/status-badge";
import type { AppealableDecision } from "@/lib/dal/appeals";
import { formatDate } from "@/lib/i18n/format";
import { appealableDecisionLabels, appealStatusLabels, appealStatusTones } from "@/lib/validation/appeal";

export function decisionSubject(decision: Pick<AppealableDecision, "action" | "title">): string {
  return `${appealableDecisionLabels[decision.action] ?? "Decision"}: ${decision.title}`;
}

// Where an appeal of the decision stands for the person reading it (FR-S1 AC12): under review or decided with the reasons,
// the Appeal button for an owner or admin, or why there is none (a member, the window ended, the decision was undone).
export function AppealState({ decision, now = new Date() }: { decision: AppealableDecision; now?: Date }) {
  const { appeal } = decision;
  if (appeal) {
    return (
      <div className="grid gap-2">
        <p>
          <StatusBadge status={appealStatusTones[appeal.status]}>{appealStatusLabels[appeal.status]}</StatusBadge>
        </p>
        {appeal.status === "open" ? (
          <p>
            Appeal sent on {formatDate(appeal.lodgedAt)}. A moderator who did not take the decision reviews it; we aim to
            decide by {formatDate(appeal.dueAt)}.
          </p>
        ) : (
          <>
            <p>{appeal.decidedAt ? `The appeal was decided on ${formatDate(appeal.decidedAt)}.` : "The appeal was decided."}</p>
            {appeal.reasons ? (
              <div className="grid gap-1">
                <p className="font-semibold">Reasons for the outcome</p>
                <blockquote className="border-s-2 border-border ps-3 whitespace-pre-line wrap-anywhere">{appeal.reasons}</blockquote>
              </div>
            ) : null}
          </>
        )}
        <details className="text-small">
          <summary className="cursor-pointer font-medium">Your grounds</summary>
          <p className="mt-1 whitespace-pre-line wrap-anywhere">{appeal.grounds}</p>
        </details>
      </div>
    );
  }
  if (decision.canAppeal) {
    return (
      <div className="grid gap-2">
        <p>If you think this was a mistake, you can appeal until {formatDate(decision.appealUntil)}.</p>
        <div>
          <AppealButton decision={decision.id} subject={decisionSubject(decision)} targetDays={decision.targetDays} />
        </div>
      </div>
    );
  }
  if (!decision.inEffect) return <p>This decision is no longer in effect.</p>;
  if (new Date(decision.appealUntil) < now) return <p>The time to appeal this decision ended on {formatDate(decision.appealUntil)}.</p>;
  return (
    <p>
      The owner or an admin of {decision.organizationName} can appeal this decision until {formatDate(decision.appealUntil)}.
    </p>
  );
}
