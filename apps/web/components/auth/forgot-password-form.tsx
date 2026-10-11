"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { requestPasswordReset } from "@/lib/actions/recovery";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validation/login";

const ids = { email: "forgot-email" };

export function ForgotPasswordForm({ defaultEmail }: { defaultEmail?: string }) {
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: defaultEmail ?? "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "Could not send the link" });

  return (
    <form
      noValidate
      className="grid gap-6"
      onSubmit={(event) => handleSubmit((values) => submit(() => requestPasswordReset(values)))(event)}
    >
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      <InputField
        control={control}
        name="email"
        id={ids.email}
        label="Email"
        type="email"
        autoComplete="username"
      />
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Sending..." : "Send reset link"}
      </FormButton>
    </form>
  );
}
