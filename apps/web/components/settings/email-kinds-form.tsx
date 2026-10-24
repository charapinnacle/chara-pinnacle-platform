"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { CheckboxRow } from "@/components/forms/checkbox-field";
import { FormButton } from "@/components/forms/form-button";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { saveEmailKindSettings } from "@/lib/actions/notifications";
import type { NotificationKindSetting } from "@/lib/dal/notifications";
import { emailKindsSchema, type EmailKinds } from "@/lib/validation/notifications";

const FAILURE = "The email choices were not saved";

// One switch per optional kind; a failed save keeps what the person chose, so they can try again.
export function EmailKindsForm({ kinds }: { kinds: NotificationKindSetting[] }) {
  const form = useForm<EmailKinds>({
    resolver: zodResolver(emailKindsSchema),
    defaultValues: { kinds: Object.fromEntries(kinds.map(({ kind, emailEnabled }) => [kind, emailEnabled])) },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, reset } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE });

  function save(values: EmailKinds) {
    return submit(
      () => saveEmailKindSettings(values),
      (result) => {
        if (result.done) {
          reset(values);
          toast({ title: "Email choices saved" });
        } else if (result.message) {
          toastError(FAILURE, result.message);
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(save)}>
      <fieldset className="grid gap-1">
        <legend className="mb-1 font-semibold">Email me about</legend>
        {kinds.map(({ kind, label }) => (
          <Controller
            key={kind}
            control={control}
            name={`kinds.${kind}`}
            render={({ field }) => (
              <CheckboxRow
                id={`email-kind-${kind}`}
                name={field.name}
                inputRef={field.ref}
                checked={Boolean(field.value)}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={false}
                asSwitch
              >
                {label}
              </CheckboxRow>
            )}
          />
        ))}
      </fieldset>
      <div>
        <FormButton type="submit" busy={formState.isSubmitting} className="w-full sm:w-auto">
          Save email choices
        </FormButton>
      </div>
    </form>
  );
}
