"use client";

import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { withdrawContactRequest } from "@/lib/actions/contact-requests";

// Withdraws a request that waits for the worker (NFR-U4). The worker is not told; the request still counts for 30 days.
export function WithdrawContactRequest({ slug, requestId, cardLabel }: { slug: string; requestId: string; cardLabel: string }) {
  const { pending, run } = useActionCall("The request was not withdrawn");
  return (
    <FormButton
      type="button"
      variant="secondary"
      className="w-auto"
      busy={pending}
      aria-label={`Withdraw the contact request: ${cardLabel}`}
      onClick={() => {
        if (!pending) run(() => withdrawContactRequest(slug, requestId), "Contact request withdrawn");
      }}
    >
      Withdraw request
    </FormButton>
  );
}
