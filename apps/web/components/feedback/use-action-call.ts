"use client";

import { useTransition } from "react";
import { toast } from "@/components/feedback/toast-store";
import { isRedirectError } from "@/lib/redirect-error";

// A button that runs one server action: a toast says what happened, and onSettled runs first so that a modal is closed
// before the toast appears (a toast outside a modal cannot be reached while the modal is open). A call that answers
// silent shows its outcome itself, so no toast follows.
export function useActionCall(failureTitle: string) {
  const [pending, startTransition] = useTransition();

  function run(call: () => Promise<{ message?: string; silent?: boolean }>, success: string, onSettled?: () => void) {
    startTransition(async () => {
      try {
        const result = await call();
        onSettled?.();
        if (result.silent) return;
        if (result.message) {
          toast({ variant: "error", title: failureTitle, description: result.message });
          return;
        }
        toast({ title: success });
      } catch (error) {
        if (isRedirectError(error)) return;
        onSettled?.();
        toast({ variant: "error", title: failureTitle, description: "Check your connection and try again." });
      }
    });
  }

  return { pending, run };
}
