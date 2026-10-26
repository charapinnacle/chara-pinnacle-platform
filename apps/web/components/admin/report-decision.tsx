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
import { decideReport, moveReport } from "@/lib/actions/admin-reports";
import { characters } from "@/lib/utils";
import { moderationFormSchema, type ModerationForm } from "@/lib/validation/admin";
import type { ReportDecisionValue } from "@/lib/validation/report";

// What the decision is about, as the dialog names it (FR-S1 AC10): the kind and title of the target and its organisation.
export type DecisionTarget = { kind: string; title: string; organization: string | null };

type ReportDecisionProps = {
  id: number;
  status: "new" | "in_review";
  reference: string;
  signedIn: boolean;
  target: DecisionTarget;
  decisions: readonly ReportDecisionValue[];
  // A report about a candidate or a page: nothing on the platform to act on, so it is closed with a note.
  closeWithNote: boolean;
};

type Choice = "in_review" | "actioned" | ReportDecisionValue;

const REASONS_MAX = 2000;
const REASONS_MIN = 10;

const words: Record<Choice, { open: string; title: string; confirm: string; done: string }> = {
  in_review: { open: "Mark in review", title: "Put the report in review", confirm: "Mark in review", done: "The report is in review" },
  actioned: { open: "Mark actioned", title: "Mark the report actioned", confirm: "Mark actioned", done: "The report is marked actioned" },
  hide: { open: "Hide", title: "Hide", confirm: "Hide", done: "Hidden. The report is actioned" },
  suspend_organization: {
    open: "Suspend organisation",
    title: "Suspend the organisation",
    confirm: "Suspend organisation",
    done: "The organisation is suspended. The report is actioned",
  },
  dismiss: { open: "Dismiss", title: "Dismiss the report", confirm: "Dismiss report", done: "The report is dismissed" },
};

const NOTE_ID = "report-note";

function audience(choice: Choice, signedIn: boolean, reference: string): string {
  if (choice === "in_review") return "It is kept in the audit record; the reporter does not read it.";
  const affected =
    choice === "hide" || choice === "suspend_organization" ? "The owner and administrators of the organisation are sent it with the appeal route. " : "";
  const reporter = signedIn
    ? `The reporter reads it with the outcome under My reports (${reference}).`
    : "The reporter is not an account, so it is kept in the record.";
  return `${affected}${reporter}`;
}

function dialogTitle(choice: Choice, target: DecisionTarget): string {
  return choice === "hide" ? `Hide the ${target.kind.toLowerCase()}` : words[choice].title;
}

export function ReportDecision({ id, status, reference, signedIn, target, decisions, closeWithNote }: ReportDecisionProps) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const buttons: Choice[] = [...(status === "new" ? (["in_review"] as const) : []), ...decisions, ...(closeWithNote ? (["actioned"] as const) : [])];

  return (
    <div className="flex flex-wrap gap-3">
      {buttons.map((button) => (
        <FormButton
          key={button}
          type="button"
          variant={button === "hide" || button === "suspend_organization" ? "destructive" : button === "actioned" ? "primary" : "secondary"}
          className="w-full sm:w-auto"
          onClick={() => setChoice(button)}
        >
          {words[button].open}
        </FormButton>
      ))}
      <ModalDialog open={choice !== null} onClose={() => setChoice(null)} title={choice ? dialogTitle(choice, target) : ""}>
        {choice ? (
          <DecisionForm id={id} choice={choice} reference={reference} signedIn={signedIn} target={target} onClose={() => setChoice(null)} />
        ) : null}
      </ModalDialog>
    </div>
  );
}

function DecisionForm({
  id,
  choice,
  reference,
  signedIn,
  target,
  onClose,
}: {
  id: number;
  choice: Choice;
  reference: string;
  signedIn: boolean;
  target: DecisionTarget;
  onClose: () => void;
}) {
  const router = useRouter();
  const form = useForm<ModerationForm>({
    resolver: zodResolver(moderationFormSchema),
    defaultValues: { reason: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The decision was not saved" });
  const reason = useWatch({ control, name: "reason" });
  const count = characters((reason ?? "").trim());
  const decision = choice !== "in_review" && choice !== "actioned";

  function onSubmit(values: ModerationForm) {
    return submit(
      () => (decision ? decideReport({ ...values, id, decision: choice }) : moveReport({ ...values, id, status: choice })),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({ title: words[choice].done });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      {decision ? (
        <dl className="grid gap-1 text-body">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">{target.kind}:</dt>
            <dd className="wrap-anywhere">{target.title}</dd>
          </div>
          {target.organization ? (
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold">Organisation:</dt>
              <dd className="wrap-anywhere">{target.organization}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ reason: NOTE_ID }} />
      <TextareaField
        control={control}
        name="reason"
        id={NOTE_ID}
        label={choice === "in_review" ? "Reason" : decision ? "Statement of reasons" : "Note"}
        description={`Required, ${REASONS_MIN} to ${REASONS_MAX} characters. ${count} of ${REASONS_MAX} characters used. ${audience(choice, signedIn, reference)}`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" variant={choice === "hide" || choice === "suspend_organization" ? "destructive" : "primary"} busy={formState.isSubmitting}>
          {words[choice].confirm}
        </FormButton>
      </div>
    </form>
  );
}
