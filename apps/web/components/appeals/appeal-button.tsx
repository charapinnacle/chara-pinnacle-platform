"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { submitAppeal } from "@/lib/actions/appeals";
import { characterCount, formatCount } from "@/lib/i18n/format";
import { characters } from "@/lib/utils";
import { appealFormSchema, GROUNDS_MAX, GROUNDS_MIN, type AppealForm } from "@/lib/validation/appeal";

type AppealButtonProps = {
  decision: number;
  // What was decided, as the dialog names it ("Partner profile hidden: Alpha Recruit").
  subject: string;
  targetDays: number;
};

const GROUNDS_ID = "appeal-grounds";

// The Appeal button of an owner or admin (FR-S1 AC12): a dialog with the grounds, which states who reviews the appeal and
// the decision target. After the appeal is lodged a toast confirms it and the page shows it under review.
export function AppealButton({ decision, subject, targetDays }: AppealButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        Appeal
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title="Appeal the decision">
        {open ? <AppealDialogForm decision={decision} subject={subject} targetDays={targetDays} onClose={() => setOpen(false)} /> : null}
      </ModalDialog>
    </>
  );
}

function AppealDialogForm({ decision, subject, targetDays, onClose }: AppealButtonProps & { onClose: () => void }) {
  const router = useRouter();
  const form = useForm<AppealForm>({ resolver: zodResolver(appealFormSchema), defaultValues: { grounds: "" }, shouldFocusError: false });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The appeal was not sent" });
  const grounds = useWatch({ control, name: "grounds" });
  const count = characters((grounds ?? "").trim());

  function onSubmit(values: AppealForm) {
    return submit(
      () => submitAppeal({ ...values, decision }),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({ title: "Your appeal was sent. It is under review." });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <p className="text-body wrap-anywhere">{subject}</p>
      <p className="text-body text-muted-foreground">
        A moderator who did not take the decision reviews your appeal. We aim to decide within {formatCount(targetDays)}{" "}
        {targetDays === 1 ? "day" : "days"} and tell you the outcome with our reasons.
      </p>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ grounds: GROUNDS_ID }} />
      <TextareaField
        control={control}
        name="grounds"
        id={GROUNDS_ID}
        label="Grounds"
        description={`Required, ${GROUNDS_MIN} to ${GROUNDS_MAX} characters. ${characterCount(count, GROUNDS_MAX)} used. Say why you think the decision is wrong.`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          Send appeal
        </FormButton>
      </div>
    </form>
  );
}
