"use client";

import { Check, Clock, Reply, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { LinkButton } from "@/components/layout/link-button";
import { declineConnection } from "@/lib/actions/connection-actions";
import type { StatusCue, TypedMessageAction, TypedMessageCard as Card } from "@/lib/connections/typed-messages";
import { applyPath } from "@/lib/routes";

const cueIcons: Record<StatusCue, typeof Check> = { waiting: Clock, replied: Reply, done: Check, declined: X };

// What a typed message adds above its text (FR-P2 AC5, AC10; SOP step Track; NFR-U4): the kind, the status both sides
// read, with an icon beside its words, what it is about and the reader's next action.
export function TypedMessageCard({ lang, card }: { lang: string; card: Exclude<Card, { kind: "text" }> }) {
  const Icon = cueIcons[card.chip.cue];
  return (
    <div className="grid gap-2 rounded-lg border bg-background p-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{card.label}</span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-small">
          <Icon aria-hidden className="size-3.5" />
          {card.chip.text}
        </span>
      </p>
      {card.details.length > 0 ? (
        <ul className="grid gap-0.5 text-body">
          {card.details.map((detail) => (
            <li key={detail} className="wrap-anywhere">
              {detail}
            </li>
          ))}
        </ul>
      ) : null}
      {card.note ? <p className="text-small text-muted-foreground">{card.note}</p> : null}
      {card.actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {card.actions.map((action) =>
            action.type === "apply" ? (
              <LinkButton key="apply" href={applyPath(lang, action.jobId)}>
                Apply to <span className="normal-case">{action.vacancy}</span>
              </LinkButton>
            ) : (
              <DeclineConnection key="decline" connectionId={card.connectionId} action={action} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

// Decline, confirmed first like every irreversible answer.
function DeclineConnection({ connectionId, action }: { connectionId: string; action: Extract<TypedMessageAction, { type: "decline" }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const [confirming, setConfirming] = useState(false);
  const { pending, run } = useActionCall("The answer was not saved");
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto" onClick={() => setConfirming(true)}>
        {action.label}
      </FormButton>
      <ModalDialog open={confirming} onClose={() => setConfirming(false)} title={`${action.label}?`}>
        <div className="grid gap-4">
          <p className="text-body leading-relaxed">{action.confirm}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormButton type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </FormButton>
            <FormButton
              type="button"
              variant="destructive"
              busy={pending}
              onClick={() => {
                if (pending) return;
                run(
                  async () => {
                    const result = await declineConnection(connectionId, pathname);
                    if (!result.message) router.refresh();
                    return result;
                  },
                  "Declined",
                  () => setConfirming(false),
                );
              }}
            >
              Decline
            </FormButton>
          </div>
        </div>
      </ModalDialog>
    </>
  );
}
