"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Smartphone } from "lucide-react";
import { useForm } from "react-hook-form";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { codeFormSchema, type CodeFormInput } from "@/lib/validation/mfa";

type ServerResult = { errors?: Record<string, string>; message?: string };

type CodeFormProps<TResult extends ServerResult> = {
  id: string;
  description: string;
  submitLabel: string;
  busyLabel: string;
  failureTitle: string;
  devices: readonly { id: string; name: string }[];
  onSubmit: (input: CodeFormInput) => Promise<TResult | undefined>;
  onResult?: (result: TResult) => void;
};

// One submission checks one device: with two devices the user says which one the code is from, because a code cannot
// be tied to a device otherwise and every device tried would be a refused challenge. The code field keeps the focus, as
// the field of a code entered a few times in a row should.
export function CodeForm<TResult extends ServerResult>({
  id,
  description,
  submitLabel,
  busyLabel,
  failureTitle,
  devices,
  onSubmit,
  onResult,
}: CodeFormProps<TResult>) {
  const form = useForm<CodeFormInput>({
    resolver: zodResolver(codeFormSchema),
    defaultValues: { code: "", factorId: devices[0].id },
  });
  const { control, formState, handleSubmit, setFocus } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle, clearOnFailure: "code" });
  const serverMessage = formState.errors.root?.server?.message;

  function submitCode(values: CodeFormInput) {
    return submit(
      () => onSubmit(values),
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
      {devices.length > 1 ? (
        <RadioGroupField
          control={control}
          name="factorId"
          legend="Device"
          description="Choose the authenticator app that shows the code."
          options={devices.map((device) => ({ value: device.id, label: device.name, icon: Smartphone }))}
        />
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
