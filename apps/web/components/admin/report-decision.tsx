"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { moveReport } from "@/lib/actions/admin-reports";
import { moderationFormSchema, type ModerationForm } from "@/lib/validation/admin";

type ReportDecisionProps = { id: number; status: "new" | "in_review"; reference: string; signedIn: boolean };

type Outcome = "in_review" | "actioned" | "dismissed";

const words = {
  in_review: { open: "Mark in review", title: "Put the report in review", confirm: "Mark in review", done: "The report is in review" },
  actioned: { open: "Mark actioned", title: "Mark the report actioned", confirm: "Mark actioned", done: "The report is marked actioned" },
  dismissed: { open: "Dismiss", title: "Dismiss the report", confirm: "Dismiss report", done: "The report is dismissed" },
} as const;

const NOTE_ID = "report-note";

function audience(outcome: Outcome, signedIn: boolean, reference: string): string {
  if (outcome === "in_review") return "It is kept in the audit record; the reporter does not read it.";
  if (signedIn) return `The reporter reads it with the outcome under My reports (${reference}).`;
  return "The reporter is not an account, so it is kept in the record only.";
}

export function ReportDecision({ id, status, reference, signedIn }: ReportDecisionProps) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  return (
    <div className="flex flex-wrap gap-3">
      {status === "new" ? (
        <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setOutcome("in_review")}>
          {words.in_review.open}
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
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The report was not moved" });

  function onSubmit(values: ModerationForm) {
    return submit(
      () => moveReport({ ...values, id, status: outcome }),
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
        label={outcome === "in_review" ? "Reason" : "Note"}
        description={`Required, 10 to 2000 characters. ${audience(outcome, signedIn, reference)}`}
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
