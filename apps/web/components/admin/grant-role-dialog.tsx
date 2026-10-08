"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { summaryItems } from "@/components/admin/summary-items";
import { toast } from "@/components/feedback/toast-store";
import { ErrorSummary } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { ModalDialog } from "@/components/team/modal-dialog";
import { grantRole } from "@/lib/actions/admin-staff";
import { grantFormSchema, platformRoleLabels, type GrantForm, type GrantOutput } from "@/lib/validation/admin";

const ids = { email: "grant-email", role: "grant-role", reason: "grant-reason" } as const;

const roleOptions = Object.entries(platformRoleLabels).map(([value, label]) => ({ value, label }));

export function GrantRoleDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <FormButton type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        Grant a role
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title="Grant a platform role">
        <Form onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function Form({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const form = useForm<GrantForm, unknown, GrantOutput>({
    resolver: zodResolver(grantFormSchema),
    defaultValues: { email: "", role: "", reason: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The role was not granted" });

  function onSubmit(values: GrantOutput) {
    return submit(
      () => grantRole(values),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({ title: "The role is granted. The person is signed out and signs in again." });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <ErrorSummary
        ref={summaryRef}
        items={summaryItems(formState.errors, ids)}
        onSelect={(key) => form.setFocus(key as FieldPath<GrantForm>)}
      />
      <InputField control={control} name="email" id={ids.email} label="Email address of the person" type="email" autoComplete="off" />
      <SelectField control={control} name="role" id={ids.role} label="Role" placeholder="Choose a role" options={roleOptions} />
      <TextareaField control={control} name="reason" id={ids.reason} label="Reason" description="Required, 10 to 500 characters. It is written to the audit log." />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          Grant role
        </FormButton>
      </div>
    </form>
  );
}
