"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { InputField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "@/lib/actions/recovery";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validation/login";

export function ForgotPasswordForm() {
  const { control, handleSubmit, setError, formState } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordInput) {
    try {
      const result = await requestPasswordReset(values);
      if (result.errors?.email) {
        setError("email", { message: result.errors.email });
      } else if (result.message) {
        setError("root.server", { message: result.message });
      }
    } catch {
      toast({
        variant: "error",
        title: "Could not send the link",
        description: "Check your connection and try again.",
      });
    }
  }

  const failed = Boolean(formState.errors.root?.server || formState.errors.email);
  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      {formState.isSubmitSuccessful && !failed ? (
        <p role="status" className="text-sm">
          If an account exists for this email, we have sent a reset link.
        </p>
      ) : null}
      {formState.errors.root?.server ? (
        <p role="alert" className="text-sm text-destructive">
          {formState.errors.root.server.message}
        </p>
      ) : null}
      <InputField
        control={control}
        name="email"
        label="Email"
        type="email"
        autoComplete="username"
      />
      <Button type="submit" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? "Sending..." : "Send reset link"}
      </Button>
    </form>
  );
}
