"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldPath } from "react-hook-form";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { signIn } from "@/lib/actions/login";
import { defaultLocale } from "@/lib/i18n/locale";
import { loginSchema, type LoginFormInput } from "@/lib/validation/login";

const ids = { email: "login-email", password: "login-password" };
const formLinkClassName = "-mt-3 justify-self-start text-body";

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
        <TextLink standalone href={`/${defaultLocale}/verify-email`} className={formLinkClassName}>
          Request a new confirmation link
        </TextLink>
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
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Logging in..." : "Log in"}
      </FormButton>
      <TextLink standalone href={`/${defaultLocale}/forgot-password`} className={formLinkClassName}>
        Forgot your password?
      </TextLink>
    </form>
  );
}
