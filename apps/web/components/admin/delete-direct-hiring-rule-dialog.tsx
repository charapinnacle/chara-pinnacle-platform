"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { deleteDirectHiringRule } from "@/lib/actions/direct-hiring-rules";
import { deleteConsequenceText, deleteRuleFormSchema, destinationText, type DeleteRuleForm, type DirectHiringRule } from "@/lib/validation/direct-hiring-rules";

const FAILURE = "The rule was not deleted";

// Deletes a rule after confirmation (FR-Q5 AC10, AC12): the dialog says what applies to the country afterwards.
export function DeleteDirectHiringRuleDialog({ rule }: { rule: DirectHiringRule }) {
  const [open, setOpen] = useState(false);
  const pair = `${rule.sourceName}, ${destinationText(rule.destinationName)}`;
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        Delete<span className="sr-only"> the rule for {pair}</span>
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title={`Delete the rule for ${pair}`}>
        {open ? <DeleteForm rule={rule} onClose={() => setOpen(false)} /> : null}
      </ModalDialog>
    </>
  );
}

function DeleteForm({ rule, onClose }: { rule: DirectHiringRule; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<DeleteRuleForm>({ resolver: zodResolver(deleteRuleFormSchema), defaultValues: { reason: "" }, shouldFocusError: true });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE });
  const reasonId = `delete-rule-${rule.id}-reason`;

  function onSubmit(values: DeleteRuleForm) {
    return submit(
      () => deleteDirectHiringRule({ id: rule.id, reason: values.reason }),
      (result) => {
        if (result.message) toastError(FAILURE, result.message);
        if (!result.done) return;
        onClose();
        toast({ title: "The rule is deleted" });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <p className="text-body">{deleteConsequenceText(rule)}</p>
      <FormErrorSummary form={form} ids={{ reason: reasonId }} />
      <TextareaField control={control} name="reason" id={reasonId} label="Reason for the change" description="Required, 10 to 500 characters." />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" variant="destructive" busy={formState.isSubmitting}>
          Delete rule
        </FormButton>
      </div>
    </form>
  );
}
