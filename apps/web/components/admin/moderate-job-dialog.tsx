"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { DetailList } from "@/components/layout/detail-list";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { moderateJob } from "@/lib/actions/admin-moderation";
import { moderationFormSchema, type ModerationForm } from "@/lib/validation/admin";

type Action = "hide" | "unhide";

type ModerateJobDialogProps = { id: string; title: string; organizationName: string; action: Action };

const words = {
  hide: {
    open: "Hide this vacancy",
    title: "Hide a vacancy",
    confirm: "Hide vacancy",
    description: "Required, 10 to 2000 characters. The owner and administrators of the organisation are emailed the reasons.",
    done: "The vacancy is hidden",
  },
  unhide: {
    open: "Unhide this vacancy",
    title: "Unhide a vacancy",
    confirm: "Unhide vacancy",
    description: "Required, 10 to 2000 characters. It is written to the record. No email is sent.",
    done: "The vacancy is unhidden",
  },
} as const;

const REASON_ID = "moderate-job-reason";

export function ModerateJobDialog(props: ModerateJobDialogProps) {
  const [open, setOpen] = useState(false);
  const { action } = props;

  return (
    <>
      <FormButton type="button" variant={action === "hide" ? "destructive" : "secondary"} className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        {words[action].open}
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title={words[action].title}>
        <Form {...props} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function Form({ id, title, organizationName, action, onClose }: ModerateJobDialogProps & { onClose: () => void }) {
  const router = useRouter();
  const form = useForm<ModerationForm>({
    resolver: zodResolver(moderationFormSchema),
    defaultValues: { reason: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The change was not saved" });

  function onSubmit(values: ModerationForm) {
    return submit(
      () => moderateJob({ ...values, id, action }),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({ title: words[action].done });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ reason: REASON_ID }} />
      <DetailList items={[{ label: "Vacancy", value: title }, { label: "Organisation", value: organizationName }]} />
      <TextareaField control={control} name="reason" id={REASON_ID} label="Statement of reasons" description={words[action].description} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" variant={action === "hide" ? "destructive" : "primary"} busy={formState.isSubmitting}>
          {words[action].confirm}
        </FormButton>
      </div>
    </form>
  );
}
