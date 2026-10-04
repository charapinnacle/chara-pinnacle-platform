"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { acceptInvitation } from "@/lib/actions/team";
import { isRedirectError } from "@/lib/redirect-error";

export function AcceptInvitationButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function accept() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await acceptInvitation(token);
        if (result) {
          setMessage(result.message);
          toast({ variant: "error", title: "Could not accept the invitation", description: result.message });
        }
      } catch (error) {
        if (isRedirectError(error)) return;
        toast({
          variant: "error",
          title: "Could not accept the invitation",
          description: "Check your connection and try again.",
        });
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
      <FormButton type="button" busy={pending} onClick={accept}>
        {pending ? "Accepting..." : "Accept invitation"}
      </FormButton>
    </div>
  );
}
