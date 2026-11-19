"use client";

import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { deleteSavedSearch } from "@/lib/actions/find-employers";

export function DeleteSavedSearchButton({ slug, id, label }: { slug: string; id: string; label: string }) {
  const { pending, run } = useActionCall("The saved search was not deleted");
  return (
    <FormButton
      type="button"
      variant="secondary"
      className="w-auto"
      aria-busy={pending || undefined}
      aria-label={`Delete saved search: ${label}`}
      onClick={() => {
        if (!pending) run(() => deleteSavedSearch(slug, id), "Saved search deleted");
      }}
    >
      Delete
    </FormButton>
  );
}
