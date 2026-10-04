"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { InputField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/actions/login";
import { defaultLocale } from "@/lib/i18n/locale";
import { isRedirectError } from "@/lib/redirect-error";
import { loginSchema, type LoginFormInput } from "@/lib/validation/login";

const ids = { email: "login-email", password: "login-password" };

export function LoginForm({ next }: { next?: string }) {
  const form = useForm<LoginFormInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, setError, resetField } = form;
  const summaryRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (formState.submitCount > 0 && summaryRef.current) summaryRef.current.focus();
  }, [formState.submitCount]);

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

  async function onSubmit(values: LoginFormInput) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await signIn({ ...values, next });
      if (!result) return;
      resetField("password");
      for (const [path, message] of Object.entries(result.errors ?? {})) {
        setError(path as FieldPath<LoginFormInput>, { message });
      }
      if (result.message) {
        setError("root.server", {
          type: result.unconfirmed ? "unconfirmed" : "server",
          message: result.message,
        });
      }
    } catch (error) {
      if (isRedirectError(error)) return;
      resetField("password");
      toast({
        variant: "error",
        title: "Could not log in",
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
