"use client";

import { useState, useTransition } from "react";
import { toastError, toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { submitForReview } from "@/lib/actions/partner-review";
import { isRedirectError } from "@/lib/redirect-error";

const FAILURE_TITLE = "Could not submit your company for review";

// The button of the Ready step (FR-J1 AC10). The button stays disabled while the request runs, so a double click submits
// once (the database serialises submissions as well); a refusal is said next to it and in a toast.
export function SubmitForReview({ slug, again = false }: { slug: string; again?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await submitForReview(slug);
        if (result) {
          setMessage(result.message);
          toastError(FAILURE_TITLE, result.message);
        }
      } catch (error) {
        if (isRedirectError(error)) return;
        toastNetworkError(FAILURE_TITLE);
      }
    });
  }

  return (
    <div className="grid gap-4">
      {message ? (
        <Notice tone="error" role="alert">
          {message}
        </Notice>
      ) : null}
      <FormButton type="button" busy={pending} onClick={submit}>
        {pending ? "Submitting..." : again ? "Submit again for review" : "Submit for review"}
      </FormButton>
    </div>
  );
}
