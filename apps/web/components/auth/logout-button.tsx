"use client";

import { useTransition } from "react";
import { toast } from "@/components/feedback/toast-store";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/actions/login";
import { isRedirectError } from "@/lib/redirect-error";

export function LogoutButton() {
  const [pending, startTransition] = useTransition();

  function logOut() {
    startTransition(async () => {
      try {
        const result = await signOut();
        if (result) toast({ variant: "error", title: "Could not log out", description: result.message });
      } catch (error) {
        if (isRedirectError(error)) return;
        toast({
          variant: "error",
          title: "Could not log out",
          description: "Check your connection and try again.",
        });
      }
    });
  }

  return (
    <Button type="button" onClick={logOut} disabled={pending}>
      {pending ? "Logging out..." : "Log out"}
    </Button>
  );
}
