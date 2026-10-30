"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast } from "@/components/feedback/toast-store";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { decideResponse, setResponseSubmissions } from "@/lib/actions/responses";
import {
  decisionDone,
  decisionsFor,
  decisionVerbs,
  NOT_A_PARTY_AGREEMENT,
  type ResponseDecision,
  type ResponseStatus,
} from "@/lib/responses/presentation";
import { DECISION_NOTE_MAX, decisionFormSchema, type DecisionFormInput, type DecisionFormOutput } from "@/lib/validation/response";

type Target = { slug: string; requirementId: string; responseId: string; partnerName: string };
// focusTargetId names an element that stays when the controls go (the response's column header, the status heading): a
// confirmed decision removes the control that opened the dialog, so the focus moves there instead of to the page start.
type DecisionControlsProps = Target & { status: ResponseStatus; submissionsAllowed: boolean; focusTargetId: string };

const ids = ({ requirementId, responseId }: Target) => ({ requirementId, responseId });

const titles: Record<ResponseDecision, (partner: string) => string> = {
  shortlisted: (partner) => `Shortlist ${partner}?`,
  selected: (partner) => `Select ${partner}?`,
  declined: (partner) => `Decline the response of ${partner}?`,
};

// The decisions an owner or admin may take on one response now (FR-O3 steps Decide, Open submissions; AC2, AC10): each
// control is named with the partner ("Select Manila Recruit") and opens a confirmation with an optional note to the
// partner; a shortlisted partner may also be allowed to submit candidates. Selected, declined and withdrawn responses
// offer nothing.
export function DecisionControls({ status, submissionsAllowed, focusTargetId, ...target }: DecisionControlsProps) {
  const [decision, setDecision] = useState<ResponseDecision | null>(null);
  const permission = useActionCall("The candidate submissions were not changed");
  const decisions = decisionsFor(status);
  const close = () => setDecision(null);
  // The timer runs after the dialog has closed and handed the focus back to its trigger, and also when the refreshed page
  // has already replaced these controls (a selected or declined response offers none).
  const decided = () => {
    setDecision(null);
    window.setTimeout(() => document.getElementById(focusTargetId)?.focus(), 0);
  };

  if (decisions.length === 0) return null;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {decisions.map((value) => (
          <FormButton
            key={value}
            type="button"
            variant={value === "selected" ? "primary" : "secondary"}
            className="w-auto"
            aria-label={`${decisionVerbs[value]} ${target.partnerName}`}
            onClick={() => setDecision(value)}
          >
            {decisionVerbs[value]}
          </FormButton>
        ))}
      </div>
      {status === "shortlisted" ? (
        <FormButton
          type="button"
          variant="secondary"
          className="w-auto"
          busy={permission.pending}
          disabled={permission.pending}
          aria-label={`${submissionsAllowed ? "Close candidate submissions for" : "Allow candidate submissions from"} ${target.partnerName}`}
          onClick={() =>
            permission.run(
              () => setResponseSubmissions(target.slug, ids(target), !submissionsAllowed),
              submissionsAllowed ? "Candidate submissions closed" : "Candidate submissions allowed",
            )
          }
        >
          {submissionsAllowed ? "Close candidate submissions" : "Allow candidate submissions"}
        </FormButton>
      ) : null}
      <ModalDialog open={decision !== null} onClose={close} title={decision ? titles[decision](target.partnerName) : ""}>
        {decision ? <DecisionForm {...target} decision={decision} onClose={close} onDecided={decided} /> : null}
      </ModalDialog>
    </div>
  );
}

function DecisionForm({
  decision,
  onClose,
  onDecided,
  ...target
}: Target & { decision: ResponseDecision; onClose: () => void; onDecided: () => void }) {
  const form = useForm<DecisionFormInput, undefined, DecisionFormOutput>({
    resolver: zodResolver(decisionFormSchema),
    defaultValues: { note: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The decision was not saved" });
  const length = useWatch({ control, name: "note" }).length;
  const noteId = `decision-note-${target.responseId}`;

  function onSubmit(values: DecisionFormOutput) {
    return submit(
      () => decideResponse(target.slug, ids(target), decision, values),
      (result) => {
        if (!result.done) return;
        onDecided();
        toast({ title: decisionDone[decision] });
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ note: noteId }} />
      {decision === "selected" ? (
        <>
          <p className="text-body leading-relaxed">
            {target.partnerName} is told that you selected it and can then submit candidates for this requirement. A selection is
            final.
          </p>
          <p className="text-body leading-relaxed font-medium">{NOT_A_PARTY_AGREEMENT}.</p>
        </>
      ) : decision === "shortlisted" ? (
        <p className="text-body leading-relaxed">
          {target.partnerName} is told that you shortlisted it and sees your company&apos;s name. You can select or decline it later.
        </p>
      ) : (
        <p className="text-body leading-relaxed">
          {target.partnerName} is told that you declined its response. A decline is final.
        </p>
      )}
      <TextareaField
        control={control}
        name="note"
        id={noteId}
        label="Note to the partner"
        description={`Optional. The partner will see this note, no one else. ${length}/${DECISION_NOTE_MAX}`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" variant={decision === "declined" ? "destructive" : "primary"} busy={formState.isSubmitting}>
          {decisionVerbs[decision]}
        </FormButton>
      </div>
    </form>
  );
}
