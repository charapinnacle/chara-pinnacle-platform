"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { EnrolmentForm } from "@/components/mfa/enrolment-form";
import { startFactorEnrolment } from "@/lib/actions/mfa";
import type { Enrolment } from "@/lib/dal/mfa";
import {
  BACKUP_FACTOR_NAME,
  enrolmentStartSchema,
  FIRST_FACTOR_NAME,
  type EnrolmentStartInput,
} from "@/lib/validation/mfa";

type EnrolmentStartFormProps = { first?: boolean; next?: string };

// Auth creates the factor and its secret when the form is submitted, never when the page renders, so a reload or a
// crawler cannot replace the secret of a QR code the user has already scanned.
export function EnrolmentStartForm({ first = false, next }: EnrolmentStartFormProps) {
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const form = useForm<EnrolmentStartInput>({
    resolver: zodResolver(enrolmentStartSchema),
    defaultValues: { name: first ? FIRST_FACTOR_NAME : BACKUP_FACTOR_NAME },
  });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: "Could not start the setup" });
  const serverMessage = formState.errors.root?.server?.message;

  if (enrolment) return <EnrolmentForm enrolment={enrolment} next={next} />;

  function start(values: EnrolmentStartInput) {
    return submit(
      () => startFactorEnrolment(values),
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
      {first ? null : (
        <InputField
          control={control}
          name="name"
          id="mfa-backup-name"
          label="Device name"
          description="Up to 32 characters, for example the name of your second phone."
          autoComplete="off"
        />
      )}
      <FormButton type="submit" variant={first ? "primary" : "secondary"} busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Starting..." : first ? "Show the QR code" : "Add a backup device"}
      </FormButton>
    </form>
  );
}
