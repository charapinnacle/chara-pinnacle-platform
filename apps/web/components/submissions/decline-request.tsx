"use client";

import { useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { declineSubmission } from "@/lib/actions/submissions";

type DeclineRequestProps = { submissionId: string; partnerName: string; title: string };

// The candidate declines the request (FR-O4 step Decline, AC7), after a confirmation: nothing reaches the employer and
// the partner reads "Declined by candidate".
export function DeclineRequest({ submissionId, partnerName, title }: DeclineRequestProps) {
  const [open, setOpen] = useState(false);
  const decline = useActionCall("The request was not declined");
  const close = () => setOpen(false);
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto justify-self-start" onClick={() => setOpen(true)}>
        Decline request
      </FormButton>
      <ModalDialog open={open} onClose={close} title="Decline this request?">
        <p className="text-body leading-relaxed wrap-anywhere">
          {partnerName} asked to submit you for {title}.
        </p>
        <p className="text-body leading-relaxed">Nothing is shared with the employer. {partnerName} sees that you declined.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" className="w-full" onClick={close}>
            Cancel
          </FormButton>
          <FormButton
            type="button"
            variant="destructive"
            busy={decline.pending}
            onClick={() => decline.run(() => declineSubmission(submissionId), "Request declined", close)}
          >
            {decline.pending ? "Declining" : "Decline"}
          </FormButton>
        </div>
      </ModalDialog>
    </>
  );
}
