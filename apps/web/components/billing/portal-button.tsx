"use client";

import { useForm } from "react-hook-form";
import { toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { openPortal } from "@/lib/actions/billing";

type PortalButtonProps = { slug: string; label?: string; variant?: "primary" | "secondary" };

// Card changes, plan changes, cancellation, tax details and invoices are all done on the provider's pages.
export function PortalButton({ slug, label = "Manage billing", variant }: PortalButtonProps) {
  const form = useForm();
  const { submit } = useServerFormSubmit(form, { failureTitle: "Could not open billing" });

  function onSubmit() {
    return submit(
      () => openPortal(slug),
      (result) => {
        if (result.message) toastError("Could not open billing", result.message);
      },
    );
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormButton type="submit" variant={variant} busy={form.formState.isSubmitting} className="w-full sm:w-auto">
        {form.formState.isSubmitting ? "Opening billing..." : label}
      </FormButton>
    </form>
  );
}
