"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { Notice } from "@/components/forms/notice";
import { TextareaField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { decidePartner } from "@/lib/actions/admin-partner-reviews";
import { characterCount } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import {
  decisionFormSchema,
  CHECKLIST_REQUIRED,
  firstUncheckedPoint,
  infoStepStaffLabels,
  STAFF_REVIEW_CHECKS,
  type DecisionForm,
  type PartnerDecision,
} from "@/lib/validation/partner-review";

const REASON_MAX = 2000;
const REASON_ID = "partner-decision-reason";
const STEP_ID = "partner-decision-step";

const words = {
  approve: {
    open: "Approve and list",
    title: "List partner",
    confirm: "List partner",
    audience: "Kept in the review record. The company is told that it is listed, without this reason.",
  },
  request_info: {
    open: "Request information",
    title: "Request information",
    confirm: "Send request",
    audience: "The company reads this message with the step it reopens.",
  },
  decline: {
    open: "Decline",
    title: "Decline partner",
    confirm: "Decline partner",
    audience: "The company reads this statement of reasons. A decline is final.",
  },
} as const satisfies Record<PartnerDecision, Record<string, string>>;

const stepOptions = Object.entries(infoStepStaffLabels).map(([value, label]) => ({ value, label }));

type PartnerDecisionProps = { lang: string; organizationId: string; companyName: string };

type ReviewChecklistProps = {
  checked?: readonly boolean[];
  onChange?: (index: number, value: boolean) => void;
  inputRefs?: React.RefObject<(HTMLInputElement | null)[]>;
  errorId?: string;
};

// What staff check before they decide (FR-J4 AC2); the ticks are not stored.
export function ReviewChecklist({ checked, onChange, inputRefs, errorId }: ReviewChecklistProps) {
  return (
    <fieldset className="grid gap-2" aria-describedby={errorId}>
      <legend className="sr-only">Review checklist</legend>
      {STAFF_REVIEW_CHECKS.map((check, index) => (
        <div key={check} className="flex items-center gap-3">
          <input
            ref={(element) => {
              if (inputRefs) inputRefs.current[index] = element;
            }}
            id={`review-check-${index}`}
            type="checkbox"
            className="size-5 accent-foreground"
            checked={checked?.[index]}
            onChange={onChange ? (event) => onChange(index, event.target.checked) : undefined}
          />
          <label htmlFor={`review-check-${index}`} className="text-body">
            {check}
          </label>
        </div>
      ))}
    </fieldset>
  );
}

// The three decisions of a Trust & Safety Administrator (FR-J4 AC3, AC11), each in a dialog that asks for the statement of
// reasons, and for a request for information the step it reopens. Approve and list opens only once every point of the
// checklist is ticked (the review control of FR-J4); a request for information or a decline is what staff do when a point
// does not hold, so they stay open. The dialog keeps the text when the call fails; after a decision the reviewer returns
// to the queue with focus on the next partner.
export function PartnerDecisionControls({ lang, organizationId, companyName }: PartnerDecisionProps) {
  const [decision, setDecision] = useState<PartnerDecision | null>(null);
  const [checked, setChecked] = useState<boolean[]>(() => STAFF_REVIEW_CHECKS.map(() => false));
  const [checklistError, setChecklistError] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function approve() {
    const missing = firstUncheckedPoint(checked);
    if (missing !== null) {
      setChecklistError(true);
      inputRefs.current[missing]?.focus();
      return;
    }
    setDecision("approve");
  }

  return (
    <div className="grid gap-4">
      <ReviewChecklist
        checked={checked}
        onChange={(index, value) => {
          const next = checked.map((item, position) => (position === index ? value : item));
          setChecked(next);
          if (firstUncheckedPoint(next) === null) setChecklistError(false);
        }}
        inputRefs={inputRefs}
        errorId={checklistError ? "review-checklist-error" : undefined}
      />
      {checklistError ? (
        <Notice id="review-checklist-error" tone="error" role="alert">
          {CHECKLIST_REQUIRED}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <FormButton type="button" className="w-full sm:w-auto" onClick={approve}>
          {words.approve.open}
        </FormButton>
        <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setDecision("request_info")}>
          {words.request_info.open}
        </FormButton>
        <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setDecision("decline")}>
          {words.decline.open}
        </FormButton>
      </div>
      <ModalDialog open={decision !== null} onClose={() => setDecision(null)} title={decision ? words[decision].title : ""}>
        {decision ? (
          <DecisionFormView
            lang={lang}
            organizationId={organizationId}
            companyName={companyName}
            decision={decision}
            onClose={() => setDecision(null)}
          />
        ) : null}
      </ModalDialog>
    </div>
  );
}

type DecisionFormViewProps = PartnerDecisionProps & { decision: PartnerDecision; onClose: () => void };

function DecisionFormView({ lang, organizationId, companyName, decision, onClose }: DecisionFormViewProps) {
  const router = useRouter();
  const form = useForm<DecisionForm>({
    resolver: zodResolver(decisionFormSchema(decision)),
    defaultValues: { reason: "", infoStep: "" },
    shouldFocusError: true,
  });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: "The decision was not saved" });
  const length = useWatch({ control, name: "reason" }).trim().length;

  function onSubmit(values: DecisionForm) {
    return submit(
      () =>
        decidePartner({
          organizationId,
          decision,
          reason: values.reason,
          infoStep: values.infoStep === "" ? null : values.infoStep,
        }),
      (result) => {
        if (result.message) {
          toastError("The decision was not saved", result.message);
          return;
        }
        if (!result.done) return;
        onClose();
        router.push(`${adminPath(lang, "partners")}?decided=1`);
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <p className="text-body text-muted-foreground">{companyName}</p>
      <FormErrorSummary form={form} ids={{ infoStep: STEP_ID, reason: REASON_ID }} />
      {decision === "request_info" ? (
        <SelectField control={control} name="infoStep" id={STEP_ID} label="Step to reopen" placeholder="Choose a step" options={stepOptions} />
      ) : null}
      <TextareaField
        control={control}
        name="reason"
        id={REASON_ID}
        label={decision === "request_info" ? "Message to the company" : "Reason"}
        description={`Required, 10 to ${REASON_MAX} characters. ${words[decision].audience}`}
      />
      <p aria-live="polite" className="-mt-2 text-small text-muted-foreground tabular-nums">
        {characterCount(length, REASON_MAX)}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" variant={decision === "decline" ? "destructive" : "primary"} busy={formState.isSubmitting}>
          {words[decision].confirm}
        </FormButton>
      </div>
    </form>
  );
}
