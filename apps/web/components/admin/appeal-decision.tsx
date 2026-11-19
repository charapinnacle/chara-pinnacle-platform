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
import { decideAppeal } from "@/lib/actions/admin-appeals";
import { characters } from "@/lib/utils";
import { moderationFormSchema, type ModerationForm } from "@/lib/validation/admin";
import type { AppealOutcome } from "@/lib/validation/appeal";

type AppealDecisionProps = {
  id: number;
  // What the decision took away, as the dialog names it ("Partner profile hidden: Alpha Recruit").
  subject: string;
  // What a reversal does, for the confirmation ("The partner profile is shown again.").
  undo: string;
};

const REASONS_MAX = 2000;
const REASONS_MIN = 10;
const NOTE_ID = "appeal-reasons";

const words: Record<AppealOutcome, { open: string; title: string; confirm: string; done: string }> = {
  uphold: { open: "Uphold the decision", title: "Uphold the decision", confirm: "Uphold decision", done: "The decision is upheld" },
  restore: { open: "Reverse the decision", title: "Reverse the decision", confirm: "Reverse decision", done: "The decision is reversed" },
};

// The second reviewer's decision on an appeal (FR-S1 AC9), by keyboard as every console dialog: uphold, or reverse what the
// decision took away, each with the statement of reasons the appellant is sent.
export function AppealDecision({ id, subject, undo }: AppealDecisionProps) {
  const [outcome, setOutcome] = useState<AppealOutcome | null>(null);
  return (
    <div className="flex flex-wrap gap-3">
      {(["restore", "uphold"] as const).map((choice) => (
        <FormButton
          key={choice}
          type="button"
          variant={choice === "restore" ? "primary" : "secondary"}
          className="w-full sm:w-auto"
          onClick={() => setOutcome(choice)}
        >
          {words[choice].open}
        </FormButton>
      ))}
      <ModalDialog open={outcome !== null} onClose={() => setOutcome(null)} title={outcome ? words[outcome].title : ""}>
        {outcome ? <DecisionForm id={id} outcome={outcome} subject={subject} undo={undo} onClose={() => setOutcome(null)} /> : null}
      </ModalDialog>
    </div>
  );
}

function DecisionForm({ id, outcome, subject, undo, onClose }: AppealDecisionProps & { outcome: AppealOutcome; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<ModerationForm>({ resolver: zodResolver(moderationFormSchema), defaultValues: { reason: "" }, shouldFocusError: false });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The decision on the appeal was not saved" });
  const reason = useWatch({ control, name: "reason" });
  const count = characters((reason ?? "").trim());

  function onSubmit(values: ModerationForm) {
    return submit(
      () => decideAppeal({ ...values, id, outcome }),
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
      <p className="text-body wrap-anywhere">{subject}</p>
      <p className="text-body text-muted-foreground">{outcome === "restore" ? undo : "Nothing changes; the decision stays in place."}</p>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ reason: NOTE_ID }} />
      <TextareaField
        control={control}
        name="reason"
        id={NOTE_ID}
        label="Statement of reasons"
        description={`Required, ${REASONS_MIN} to ${REASONS_MAX} characters. ${count} of ${REASONS_MAX} characters used. The person who appealed is sent it with the outcome.`}
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
