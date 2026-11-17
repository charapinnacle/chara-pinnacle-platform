"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast, toastError, toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { respondToContactRequest } from "@/lib/actions/contact-requests";
import { isRedirectError } from "@/lib/redirect-error";
import type { ContactDecision } from "@/lib/validation/contact-request";

type AnswerProps = { requestId: string; organizationName: string };

// Accept or Decline of one request (FR-Q3 AC8, AC11; SOP step Decide). Accepting takes the worker to the new conversation;
// declining asks first, because the company then cannot ask again for 90 days. Both buttons name the company.
export function AnswerContactRequest({ requestId, organizationName }: AnswerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function answer(decision: ContactDecision) {
    startTransition(async () => {
      try {
        const result = await respondToContactRequest(requestId, decision);
        setConfirming(false);
        if (result.message) {
          toastError(decision === "accept" ? "The request was not accepted" : "The request was not declined", result.message);
          return;
        }
        toast({ title: decision === "accept" ? `You accepted the request from ${organizationName}` : "Request declined" });
        if (result.conversationHref) router.push(result.conversationHref);
      } catch (error) {
        if (isRedirectError(error)) return;
        setConfirming(false);
        toastNetworkError(decision === "accept" ? "The request was not accepted" : "The request was not declined");
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-3">
      <FormButton
        type="button"
        className="w-auto"
        busy={pending && !confirming}
        aria-label={`Accept the contact request from ${organizationName}`}
        onClick={() => {
          if (!pending) answer("accept");
        }}
      >
        Accept
      </FormButton>
      <FormButton
        type="button"
        variant="secondary"
        className="w-auto"
        aria-label={`Decline the contact request from ${organizationName}`}
        onClick={() => setConfirming(true)}
      >
        Decline
      </FormButton>
      <ModalDialog open={confirming} onClose={() => setConfirming(false)} title={`Decline the request from ${organizationName}?`}>
        <div className="grid gap-4">
          <p className="text-body leading-relaxed">
            {organizationName} will see that you declined, without a reason, and cannot contact you again for 90 days. Nothing
            about you is shared.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormButton type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </FormButton>
            <FormButton
              type="button"
              variant="destructive"
              busy={pending}
              onClick={() => {
                if (!pending) answer("decline");
              }}
            >
              Decline request
            </FormButton>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
