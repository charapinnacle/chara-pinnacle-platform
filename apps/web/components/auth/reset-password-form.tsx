"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { resetPassword } from "@/lib/actions/recovery";
import { resetPasswordFormSchema, type ResetPasswordFormInput } from "@/lib/validation/login";

const ids = { password: "reset-password", code: "reset-code" };

export function ResetPasswordForm({ tokenHash }: { tokenHash: string }) {
  const form = useForm<ResetPasswordFormInput>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { password: "", code: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const [needsCode, setNeedsCode] = useState(false);
  const { summaryRef, submit } = useServerFormSubmit(form, {
    failureTitle: "Could not change the password",
  });

  useEffect(() => {
    if (needsCode) form.setFocus("code");
  }, [needsCode, form]);

  function onSubmit(values: ResetPasswordFormInput) {
    return submit(
      () =>
        resetPassword({
          tokenHash,
          password: values.password,
          code: needsCode ? values.code : undefined,
        }),
      (result) => {
        if (result.needsCode) setNeedsCode(true);
      },
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={(event) => handleSubmit(onSubmit)(event)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      <InputField
        control={control}
        name="password"
        id={ids.password}
        label="New password"
        description="At least 12 characters."
        type="password"
        autoComplete="new-password"
      />
      {needsCode ? (
        <InputField
          control={control}
          name="code"
          id={ids.code}
          label="Authenticator code"
          description="Your account uses two-step verification. Enter the 6-digit code from your authenticator app."
          inputMode="numeric"
          autoComplete="one-time-code"
        />
      ) : null}
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving..." : "Change password"}
      </FormButton>
    </form>
  );
}
