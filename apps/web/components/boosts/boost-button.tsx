"use client";

import { useForm } from "react-hook-form";
import { toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { startBoostCheckout } from "@/lib/actions/boosts";

type BoostButtonProps = { slug: string; sku: string; days: number };

// The payment is made on the provider's page; the boost starts once the provider reports it.
export function BoostButton({ slug, sku, days }: BoostButtonProps) {
  const form = useForm();
  const { submit } = useServerFormSubmit(form, { failureTitle: "Could not start the payment" });

  function onSubmit() {
    return submit(
      () => startBoostCheckout(slug, sku),
      (result) => {
        if (result.message) toastError("Could not start the payment", result.message);
      },
    );
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormButton type="submit" busy={form.formState.isSubmitting} className="w-full sm:w-auto">
        {form.formState.isSubmitting ? "Opening payment..." : "Boost profile"}
        <span className="sr-only"> for {days} days</span>
      </FormButton>
    </form>
  );
}
