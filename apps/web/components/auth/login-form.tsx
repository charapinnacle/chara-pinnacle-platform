"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { signIn } from "@/lib/actions/login";
import { defaultLocale } from "@/lib/i18n/locale";
import { loginSchema, type LoginFormInput } from "@/lib/validation/login";

const ids = { email: "login-email", password: "login-password" };

export function LoginForm({ next }: { next?: string }) {
  const form = useForm<LoginFormInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, setError } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, {
    failureTitle: "Could not log in",
    clearOnFailure: "password",
  });

  function onSubmit(values: LoginFormInput) {
    return submit(
      () => signIn({ ...values, next }),
      (result) => {
        if (result.unconfirmed && result.message) {
          setError("root.server", { type: "unconfirmed", message: result.message });
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={(event) => handleSubmit(onSubmit)(event)}>
      <FormErrorSummary
        form={form}
        summaryRef={summaryRef}
        ids={ids}
        action={
          formState.errors.root?.server?.type === "unconfirmed" ? (
            <TextLink standalone="flush" href={`/${defaultLocale}/verify-email`}>
              Request a new confirmation link
            </TextLink>
          ) : null
        }
      />
      <InputField
        control={control}
        name="email"
        id={ids.email}
        label="Email"
        type="email"
        autoComplete="username"
      />
      <InputField
        control={control}
        name="password"
        id={ids.password}
        label="Password"
        type="password"
        autoComplete="current-password"
      />
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Logging in..." : "Log in"}
      </FormButton>
      <TextLink standalone="flush" href={`/${defaultLocale}/forgot-password`}>
        Forgot your password?
      </TextLink>
    </form>
  );
}
