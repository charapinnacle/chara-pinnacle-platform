"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";

// What a page shows when its data could not be read: a toast, a message that says nothing of the cause, and a retry; a
// page that is not a list also offers the way home.
export function LoadError({ title, retry, homeHref }: { title: string; retry: () => void; homeHref?: string }) {
  useEffect(() => {
    toastNetworkError(title);
  }, [title]);

  return (
    <EmptyState icon={TriangleAlert} title={title} description="Nothing was changed. Try again in a moment.">
      <FormButton type="button" variant="secondary" onClick={retry}>
        Try again
      </FormButton>
      {homeHref ? (
        <TextLink standalone href={homeHref}>
          Go to the home page
        </TextLink>
      ) : null}
    </EmptyState>
  );
}
