"use client";

import { useForm } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { openPortal } from "@/lib/actions/billing";

// Card changes, plan changes, cancellation and invoices are all done on the provider's pages.
export function PortalButton({ slug, label = "Manage billing" }: { slug: string; label?: string }) {
  const form = useForm();
  const { submit } = useServerFormSubmit(form, { failureTitle: "Could not open billing" });

  function onSubmit() {
    return submit(
      () => openPortal(slug),
      (result) => {
        if (result.message) toast({ variant: "error", title: "Could not open billing", description: result.message });
      },
    );
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormButton type="submit" busy={form.formState.isSubmitting} className="w-full sm:w-auto">
        {form.formState.isSubmitting ? "Opening billing..." : label}
      </FormButton>
    </form>
  );
}
