"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { InputField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { resetPassword } from "@/lib/actions/recovery";
import { isRedirectError } from "@/lib/redirect-error";
import { resetPasswordFormSchema, type ResetPasswordFormInput } from "@/lib/validation/login";

const ids = { password: "reset-password", code: "reset-code" };

export function ResetPasswordForm({ tokenHash }: { tokenHash: string }) {
  const form = useForm<ResetPasswordFormInput>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { password: "", code: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, setError } = form;
  const [needsCode, setNeedsCode] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (formState.submitCount > 0 && summaryRef.current) summaryRef.current.focus();
  }, [formState.submitCount]);

  useEffect(() => {
    if (needsCode) form.setFocus("code");
  }, [needsCode, form]);

  const errors = formState.errors;
  const items: ErrorSummaryItem[] = [
    errors.password && {
      key: "password",
      message: String(errors.password.message),
      targetId: ids.password,
    },
    errors.code && { key: "code", message: String(errors.code.message), targetId: ids.code },
    errors.root?.server && { key: "root", message: String(errors.root.server.message) },
  ].filter((item): item is ErrorSummaryItem => Boolean(item));

  async function onSubmit(values: ResetPasswordFormInput) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await resetPassword({
        tokenHash,
        password: values.password,
        code: needsCode ? values.code : undefined,
      });
      if (!result) return;
      if (result.needsCode) setNeedsCode(true);
      for (const [path, message] of Object.entries(result.errors ?? {})) {
        setError(path as FieldPath<ResetPasswordFormInput>, { message });
      }
      if (result.message) setError("root.server", { message: result.message });
    } catch (error) {
      if (isRedirectError(error)) return;
      toast({
        variant: "error",
        title: "Could not change the password",
        description: "Check your connection and try again.",
      });
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={(event) => handleSubmit(onSubmit)(event)}>
      <ErrorSummary
        ref={summaryRef}
        items={items}
        onSelect={(key) => form.setFocus(key as FieldPath<ResetPasswordFormInput>)}
      />
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
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving..." : "Change password"}
      </Button>
    </form>
  );
}
