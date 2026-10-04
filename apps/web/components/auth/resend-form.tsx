"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { InputField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { resendConfirmation } from "@/lib/actions/auth";
import { resendSchema } from "@/lib/validation/sign-up";

type ResendInput = { email: string };

export function ResendForm() {
  const { control, handleSubmit, setError, formState } = useForm<ResendInput>({
    resolver: zodResolver(resendSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ResendInput) {
    try {
      const result = await resendConfirmation(values);
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

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      {formState.isSubmitSuccessful ? (
        <p role="status" className="text-sm">
          If an account with this email is waiting for confirmation, a new link
          has been sent.
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
        label="Email address"
        type="email"
        autoComplete="email"
      />
      <Button type="submit" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? "Sending..." : "Send a new link"}
      </Button>
    </form>
  );
}
