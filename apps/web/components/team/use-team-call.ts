"use client";

import { useTransition } from "react";
import { toast } from "@/components/feedback/toast-store";
import type { TeamResult } from "@/lib/actions/team";
import { isRedirectError } from "@/lib/redirect-error";

// A button that runs one team action: a toast says what happened, and onSettled runs first so that a modal is closed
// before the toast appears (a toast outside a modal cannot be reached while the modal is open).
export function useTeamCall(failureTitle: string) {
  const [pending, startTransition] = useTransition();

  function run(call: () => Promise<TeamResult>, success: string, onSettled?: () => void) {
    startTransition(async () => {
      try {
        const result = await call();
        onSettled?.();
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
