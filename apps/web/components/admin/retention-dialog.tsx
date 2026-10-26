"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FocusOnMount } from "@/components/admin/focus-on-mount";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { saveRetentionPolicy } from "@/lib/actions/retention";
import { periodText, retentionFormSchema, type RetentionForm, type RetentionPolicy } from "@/lib/validation/retention";

const FAILURE = "The retention period was not saved";

// Changes one retention period with a reason (FR-S3 AC10). The new period is confirmed before it is saved; a shorter one
// says that older records go at the next daily run.
export function RetentionDialog({ policy }: { policy: RetentionPolicy }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto" onClick={() => setOpen(true)}>
        Change<span className="sr-only"> {policy.label}</span>
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title={policy.label}>
        <PeriodForm policy={policy} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function PeriodForm({ policy, onClose }: { policy: RetentionPolicy; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<RetentionForm>({
    resolver: zodResolver(retentionFormSchema),
    defaultValues: { days: String(policy.days), reason: "" },
    shouldFocusError: true,
  });
  const { control, formState, handleSubmit, getValues, setError } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE });
  const [confirming, setConfirming] = useState<number | null>(null);
  const ids = { days: `retention-${policy.entity}-days`, reason: `retention-${policy.entity}-reason` };
  const confirmId = `retention-${policy.entity}-confirm`;

  function onReview(values: RetentionForm) {
    const next = Number(values.days.trim());
    if (next === policy.days) {
      setError("root.server", { type: "server", message: "Nothing was changed. Enter a new period." });
      return;
    }
    setConfirming(next);
  }

  function onConfirm(next: number) {
    return submit(
      () => saveRetentionPolicy({ entity: policy.entity, days: next, reason: getValues("reason") }),
      (result) => {
        if (result.done) {
          onClose();
          toast({ title: `${policy.label} is saved`, description: `Now ${periodText(next)}` });
          router.refresh();
          return;
        }
        setConfirming(null);
        if (result.message) toastError(FAILURE, result.message);
      },
    );
  }

  if (confirming !== null) {
    return (
      <div className="grid gap-4">
        <FocusOnMount targetId={confirmId} />
        <p id={confirmId} tabIndex={-1} className="text-body font-medium focus:outline-none">
          {policy.label}: {periodText(policy.days)} -&gt; {periodText(confirming)}
        </p>
        {confirming < policy.days ? (
          <Notice tone="warning" role="status">
            Records older than the new period are deleted at the next daily retention run and cannot be restored.
          </Notice>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" onClick={() => setConfirming(null)}>
            Back
          </FormButton>
          <FormButton type="button" busy={formState.isSubmitting} onClick={() => void handleSubmit(() => onConfirm(confirming))()}>
            Save period
          </FormButton>
        </div>
      </div>
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onReview)}>
      <p className="text-small text-muted-foreground">{policy.description}</p>
      <FormErrorSummary form={form} ids={ids} />
      <InputField
        control={control}
        name="days"
        id={ids.days}
        label="Period in days"
        description="A whole number from 1 to 3,650 days (10 years)."
        inputMode="numeric"
        autoComplete="off"
      />
      <TextareaField control={control} name="reason" id={ids.reason} label="Reason for the change" description="Required, 10 to 500 characters." />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit">Review change</FormButton>
      </div>
    </form>
  );
}
