"use client";

import { useTransition } from "react";
import { toastError, toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { signOut } from "@/lib/actions/login";
import { isRedirectError } from "@/lib/redirect-error";

export function LogoutButton() {
  const [pending, startTransition] = useTransition();

  function logOut() {
    startTransition(async () => {
      try {
        const result = await signOut();
        if (result) toastError("Could not log out", result.message);
      } catch (error) {
        if (isRedirectError(error)) return;
        toastNetworkError("Could not log out");
      }
    });
  }

  return (
    <FormButton type="button" variant="secondary" busy={pending} onClick={logOut} className="min-w-38 px-4 text-small">
      {pending ? "Logging out..." : "Log out"}
    </FormButton>
  );
}
