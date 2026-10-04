"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useForm, type FieldPath } from "react-hook-form";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { InputField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { Button } from "@/components/ui/button";
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

  const errors = formState.errors;
  const items: ErrorSummaryItem[] = [
    errors.email && { key: "email", message: String(errors.email.message), targetId: ids.email },
    errors.password && {
      key: "password",
      message: String(errors.password.message),
      targetId: ids.password,
    },
    errors.root?.server && { key: "root", message: String(errors.root.server.message) },
  ].filter((item): item is ErrorSummaryItem => Boolean(item));

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
      <ErrorSummary
        ref={summaryRef}
        items={items}
        onSelect={(key) => form.setFocus(key as FieldPath<LoginFormInput>)}
      />
      {errors.root?.server?.type === "unconfirmed" ? (
        <p className="text-sm">
          <Link href={`/${defaultLocale}/verify-email`} className="underline underline-offset-4">
            Request a new confirmation link
          </Link>
        </p>
      ) : null}
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
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? "Logging in..." : "Log in"}
      </Button>
      <p className="text-sm">
        <Link href={`/${defaultLocale}/forgot-password`} className="underline underline-offset-4">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
