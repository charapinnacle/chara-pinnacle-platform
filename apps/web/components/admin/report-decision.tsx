"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast, toastError, toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { closeReport, startReportReview } from "@/lib/actions/admin-reports";
import { moderationFormSchema, type ModerationForm } from "@/lib/validation/admin";

type ReportDecisionProps = { id: number; status: "new" | "in_review"; reference: string; signedIn: boolean };

type Outcome = "actioned" | "dismissed";

const words = {
  actioned: { open: "Mark actioned", title: "Mark the report actioned", confirm: "Mark actioned", done: "The report is marked actioned" },
  dismissed: { open: "Dismiss", title: "Dismiss the report", confirm: "Dismiss report", done: "The report is dismissed" },
} as const;

const NOTE_ID = "report-note";

export function ReportDecision({ id, status, reference, signedIn }: ReportDecisionProps) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [starting, setStarting] = useState(false);

  async function review() {
    setStarting(true);
    try {
      const result = await startReportReview(id);
      if (result.done) {
        toast({ title: "The report is in review" });
        router.refresh();
      } else if (result.message) {
        toastError("The report was not moved", result.message);
      }
    } catch {
      toastNetworkError("The report was not moved");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      {status === "new" ? (
        <FormButton type="button" variant="secondary" className="w-full sm:w-auto" busy={starting} onClick={review}>
          Mark in review
        </FormButton>
      ) : null}
      <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setOutcome("dismissed")}>
        {words.dismissed.open}
      </FormButton>
      <FormButton type="button" className="w-full sm:w-auto" onClick={() => setOutcome("actioned")}>
        {words.actioned.open}
      </FormButton>
      <ModalDialog open={outcome !== null} onClose={() => setOutcome(null)} title={outcome ? words[outcome].title : ""}>
        {outcome ? <NoteForm id={id} outcome={outcome} reference={reference} signedIn={signedIn} onClose={() => setOutcome(null)} /> : null}
      </ModalDialog>
    </div>
  );
}

function NoteForm({ id, outcome, reference, signedIn, onClose }: { id: number; outcome: Outcome; reference: string; signedIn: boolean; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<ModerationForm>({
    resolver: zodResolver(moderationFormSchema),
    defaultValues: { reason: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The report was not closed" });

  function onSubmit(values: ModerationForm) {
    return submit(
      () => closeReport({ ...values, id, status: outcome }),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({ title: words[outcome].done });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ reason: NOTE_ID }} />
      <TextareaField
        control={control}
        name="reason"
        id={NOTE_ID}
        label="Note"
        description={`Required, 10 to 2000 characters. ${signedIn ? `The reporter reads it with the outcome under My reports (${reference}).` : "The reporter is not an account, so it is kept in the record only."}`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          {words[outcome].confirm}
        </FormButton>
      </div>
    </form>
  );
}
