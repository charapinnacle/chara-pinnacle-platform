"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";

// What a list page shows when its data could not be read: a toast, a message that says nothing of the cause, and a retry.
export function LoadError({ title, retry }: { title: string; retry: () => void }) {
  useEffect(() => {
    toastNetworkError(title);
  }, [title]);

  return (
    <EmptyState icon={TriangleAlert} title={title} description="Nothing was changed. Try again in a moment.">
      <FormButton type="button" variant="secondary" onClick={retry}>
        Try again
      </FormButton>
    </EmptyState>
  );
}
