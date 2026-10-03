"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { toast } from "@/components/feedback/toast-store";
import { Button } from "@/components/ui/button";
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
          toast({ variant: "error", title: result.error });
          setFailed(true);
        }
      } catch (error) {
        if (isRedirectError(error)) return;
        toast({
          variant: "error",
          title: "Could not set up your account",
          description: "Check your connection and try again.",
        });
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
    <div className="grid justify-items-start gap-3">
      <p>Your account could not be set up yet.</p>
      <Button onClick={commit}>Try again</Button>
    </div>
  );
}
