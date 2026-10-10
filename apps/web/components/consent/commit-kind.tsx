"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { toastError, toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { commitAccountKind } from "@/lib/actions/consents";
import { isRedirectError } from "@/lib/redirect-error";

export function CommitKind() {
  const [, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  const commit = useCallback(() => {
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await commitAccountKind([]);
        if (result) {
          toastError(result.error);
          setFailed(true);
        }
      } catch (error) {
        if (isRedirectError(error)) return;
        toastNetworkError("Could not set up your account");
        setFailed(true);
      }
    });
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    commit();
  }, [commit]);

  if (!failed) return <LoadingSkeleton rows={2} />;
  return (
    <div className="grid gap-4">
      <p className="text-body leading-relaxed">Your account could not be set up yet.</p>
      <FormButton onClick={commit}>Try again</FormButton>
    </div>
  );
}
