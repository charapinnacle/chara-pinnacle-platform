"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { summaryItems } from "@/components/admin/summary-items";
import { toast } from "@/components/feedback/toast-store";
import { ErrorSummary } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { revokeRole } from "@/lib/actions/admin-staff";
import { revokeFormSchema, type PlatformRole } from "@/lib/validation/admin";
import type { z } from "zod";

type RevokeValues = z.input<typeof revokeFormSchema>;

const REASON_ID = "revoke-reason";

type RevokeRoleDialogProps = { userId: string; role: PlatformRole; roleLabel: string; person: string };

export function RevokeRoleDialog(props: RevokeRoleDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        Revoke<span className="sr-only"> {props.roleLabel} of {props.person}</span>
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title="Revoke a platform role">
        <Form {...props} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function Form({ userId, role, roleLabel, person, onClose }: RevokeRoleDialogProps & { onClose: () => void }) {
  const router = useRouter();
  const form = useForm<RevokeValues>({
    resolver: zodResolver(revokeFormSchema),
    defaultValues: { reason: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The role was not revoked" });

  function onSubmit(values: RevokeValues) {
    return submit(
      () => revokeRole({ ...values, userId, role }),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({ title: "The role is revoked" });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <p className="text-body">
        {person} loses the role {roleLabel} and is signed out.
      </p>
      <ErrorSummary
        ref={summaryRef}
        items={summaryItems(formState.errors, { reason: REASON_ID })}
        onSelect={(key) => form.setFocus(key as FieldPath<RevokeValues>)}
      />
      <TextareaField control={control} name="reason" id={REASON_ID} label="Reason" description="Required, 10 to 500 characters. It is written to the audit log." />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" variant="destructive" busy={formState.isSubmitting}>
          Revoke role
        </FormButton>
      </div>
    </form>
  );
}
