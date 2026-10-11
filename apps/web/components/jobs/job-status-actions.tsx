"use client";

import { useState } from "react";
import { Notice } from "@/components/forms/notice";
import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { changeJobStatus } from "@/lib/actions/jobs";
import { inProgressText, statusActions, type LimitPrompt, type StatusAction } from "@/lib/jobs/lifecycle";
import type { Database } from "@chara-pinnacle/db-types";

type JobStatusActionsProps = {
  slug: string;
  jobId: string;
  status: Database["public"]["Enums"]["job_status"];
  billingHref: string;
  // Counted when the page was drawn, not when the dialog opens.
  inProgress: number;
  applicantsHref: string;
};

// The action revalidates the page, so the buttons follow the new status; only the upgrade prompt of a refused
// publish or reopen is local state, since it belongs to that attempt.
export function JobStatusActions({ slug, jobId, status, billingHref, inProgress, applicantsHref }: JobStatusActionsProps) {
  const [confirming, setConfirming] = useState<StatusAction | null>(null);
  const [prompt, setPrompt] = useState<LimitPrompt | null>(null);
  const [running, setRunning] = useState<StatusAction["to"] | null>(null);
  const call = useActionCall("The status was not changed");
  const actions = statusActions[status];

  function run(action: StatusAction) {
    setRunning(action.to);
    setPrompt(null);
    call.run(
      async () => {
        const result = await changeJobStatus(slug, jobId, action.to);
        if (!result.limitReached) return result;
        setPrompt(result.limitReached);
        return { silent: true };
      },
      action.done,
      () => setConfirming(null),
    );
  }

  if (actions.length === 0) return null;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-3">
        {actions.map((action) => (
          <FormButton
            key={action.to}
            type="button"
            variant={action.to === "open" ? "primary" : "secondary"}
            className="w-auto"
            busy={call.pending && running === action.to}
            disabled={call.pending}
            onClick={() => (action.confirm ? setConfirming(action) : run(action))}
          >
            {action.label}
          </FormButton>
        ))}
      </div>
      {prompt ? (
        <Notice tone="warning" role="alert">
          <p className="font-medium">
            Your {prompt.planName} plan has {prompt.used} of {prompt.limit} open vacancies in use.
          </p>
          <p>
            This vacancy was not opened.{" "}
            {prompt.used > 0 && prompt.limit > 0 ? (
              <>
                Pause or close another vacancy to make room, or <TextLink href={billingHref}>upgrade your plan</TextLink>.
              </>
            ) : (
              <TextLink href={billingHref}>Upgrade your plan</TextLink>
            )}
          </p>
        </Notice>
      ) : null}
      <ModalDialog open={confirming !== null} onClose={() => setConfirming(null)} title={confirming?.confirm?.title ?? ""}>
        <p className="text-body leading-relaxed">{confirming?.confirm?.body}</p>
        {inProgress > 0 ? (
          <Notice tone="warning" role="status">
            <p className="font-medium">{inProgressText(inProgress)}.</p>
            <p>
              Their stages do not change. <TextLink href={applicantsHref}>Review the applicants of this vacancy</TextLink> to
              give each one a final update.
            </p>
          </Notice>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" className="w-full" onClick={() => setConfirming(null)}>
            Cancel
          </FormButton>
          <FormButton type="button" variant="destructive" busy={call.pending} onClick={() => confirming && run(confirming)}>
            {confirming?.confirm?.button}
          </FormButton>
        </div>
      </ModalDialog>
    </div>
  );
}
