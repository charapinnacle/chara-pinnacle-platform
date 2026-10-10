"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { resetMfa } from "@/lib/actions/admin-staff";
import { mfaResetFormSchema, type MfaResetForm as MfaResetValues } from "@/lib/validation/admin";

const ids = { userId: "mfa-user", identityChecked: "mfa-identity", reason: "mfa-reason" } as const;

export function MfaResetForm({ userId }: { userId: string }) {
  const form = useForm<MfaResetValues>({
    resolver: zodResolver(mfaResetFormSchema),
    defaultValues: { userId, identityChecked: false, reason: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, reset } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "Two-step verification was not reset" });

  function onSubmit(values: MfaResetValues) {
    return submit(
      () => resetMfa(values),
      (result) => {
        if (!result.done) return;
        reset({ userId: "", identityChecked: false, reason: "" });
        toast({ title: "The reset is queued. The person is signed out and told by email." });
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      <InputField control={control} name="userId" id={ids.userId} label="User id" autoComplete="off" />
      <CheckboxField control={control} name="identityChecked" id={ids.identityChecked}>
        I have verified this person&apos;s identity
      </CheckboxField>
      <TextareaField control={control} name="reason" id={ids.reason} label="Reason" description="Required, 10 to 500 characters. It is written to the audit log." />
      <div>
        <FormButton type="submit" busy={formState.isSubmitting} className="w-full sm:w-auto">
          Reset two-step verification
        </FormButton>
      </div>
    </form>
  );
}
