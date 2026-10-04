"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { EnrolmentForm } from "@/components/mfa/enrolment-form";
import { startBackupEnrolment } from "@/lib/actions/mfa";
import type { Enrolment } from "@/lib/dal/mfa";
import {
  BACKUP_FACTOR_NAME,
  backupFactorSchema,
  type BackupFactorFormInput,
} from "@/lib/validation/mfa";

export function BackupFactorForm() {
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const form = useForm<BackupFactorFormInput>({
    resolver: zodResolver(backupFactorSchema),
    defaultValues: { name: BACKUP_FACTOR_NAME },
  });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: "Could not add the device" });
  const serverMessage = formState.errors.root?.server?.message;

  if (enrolment) return <EnrolmentForm enrolment={enrolment} />;

  function start(values: BackupFactorFormInput) {
    return submit(
      () => startBackupEnrolment(values),
      (result) => {
        if (result.enrolment) setEnrolment(result.enrolment);
      },
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={(event) => handleSubmit(start)(event)}>
      {serverMessage ? (
        <Notice tone="error" role="alert">
          {serverMessage}
        </Notice>
      ) : null}
      <InputField
        control={control}
        name="name"
        id="mfa-backup-name"
        label="Device name"
        description="Up to 32 characters, for example the name of your second phone."
        autoComplete="off"
      />
      <FormButton type="submit" variant="secondary" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Starting..." : "Add a backup device"}
      </FormButton>
    </form>
  );
}
