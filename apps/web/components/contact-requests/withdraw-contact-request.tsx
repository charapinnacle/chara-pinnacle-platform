"use client";

import { useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { withdrawContactRequest } from "@/lib/actions/contact-requests";
import { withdrawConfirmText } from "@/lib/contact-requests/presentation";

type WithdrawProps = {
  slug: string;
  requestId: string;
  cardLabel: string;
  // When the organisation may send this worker a new request once this one is withdrawn; null: at once.
  againFrom: string | null;
};

// Withdraws a request that waits for the worker (NFR-U4), confirmed first since it cannot be undone. The worker is not
// told; the request still counts for the repeat period.
export function WithdrawContactRequest({ slug, requestId, cardLabel, againFrom }: WithdrawProps) {
  const [confirming, setConfirming] = useState(false);
  const { pending, run } = useActionCall("The request was not withdrawn");
  return (
    <>
      <FormButton
        type="button"
        variant="secondary"
        className="w-auto"
        aria-label={`Withdraw the contact request: ${cardLabel}`}
        onClick={() => setConfirming(true)}
      >
        Withdraw request
      </FormButton>
      <ModalDialog open={confirming} onClose={() => setConfirming(false)} title="Withdraw the contact request?">
        <div className="grid gap-4">
          <p className="text-body leading-relaxed">{withdrawConfirmText(againFrom)}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormButton type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </FormButton>
            <FormButton
              type="button"
              variant="destructive"
              busy={pending}
              onClick={() => {
                if (!pending) run(() => withdrawContactRequest(slug, requestId), "Contact request withdrawn", () => setConfirming(false));
              }}
            >
              Withdraw request
            </FormButton>
          </div>
        </div>
      </ModalDialog>
    </>
  );
}
