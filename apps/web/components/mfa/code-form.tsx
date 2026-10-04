"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { challengeSchema, type CodeFormInput } from "@/lib/validation/mfa";

type ServerResult = { errors?: Record<string, string>; message?: string };

type CodeFormProps<TResult extends ServerResult> = {
  id: string;
  description: string;
  submitLabel: string;
  busyLabel: string;
  failureTitle: string;
  onSubmit: (code: string) => Promise<TResult | undefined>;
  onResult?: (result: TResult) => void;
};

// The code field is the only field, so its error sits beside it and the focus stays in it, as the field of a code
// entered a few times in a row should.
export function CodeForm<TResult extends ServerResult>({
  id,
  description,
  submitLabel,
  busyLabel,
  failureTitle,
  onSubmit,
  onResult,
}: CodeFormProps<TResult>) {
  const form = useForm<CodeFormInput>({
    resolver: zodResolver(challengeSchema),
    defaultValues: { code: "" },
  });
  const { control, formState, handleSubmit, setFocus } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle, clearOnFailure: "code" });
  const serverMessage = formState.errors.root?.server?.message;

  function submitCode({ code }: CodeFormInput) {
    return submit(
      () => onSubmit(code),
      (result) => {
        setFocus("code");
        onResult?.(result);
      },
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={(event) => handleSubmit(submitCode)(event)}>
      {serverMessage ? (
        <Notice tone="error" role="alert">
          {serverMessage}
        </Notice>
      ) : null}
      <InputField
        control={control}
        name="code"
        id={id}
        label="Authentication code"
        description={description}
        inputMode="numeric"
        autoComplete="one-time-code"
      />
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? busyLabel : submitLabel}
      </FormButton>
    </form>
  );
}
