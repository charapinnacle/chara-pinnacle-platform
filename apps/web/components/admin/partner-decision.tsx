"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { decidePartner } from "@/lib/actions/admin-partner-reviews";
import { adminPath } from "@/lib/routes";
import {
  decisionFormSchema,
  infoStepStaffLabels,
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

// The three decisions of a Trust & Safety Administrator (FR-J4 AC3, AC11), each in a dialog that asks for the statement of
// reasons, and for a request for information the step it reopens. The dialog keeps the text when the call fails; after a
// decision the reviewer returns to the queue with focus on the next partner.
export function PartnerDecisionControls({ lang, organizationId, companyName }: PartnerDecisionProps) {
  const [decision, setDecision] = useState<PartnerDecision | null>(null);

  return (
    <div className="flex flex-wrap gap-3">
      <FormButton type="button" className="w-full sm:w-auto" onClick={() => setDecision("approve")}>
        {words.approve.open}
      </FormButton>
      <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setDecision("request_info")}>
        {words.request_info.open}
      </FormButton>
      <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setDecision("decline")}>
        {words.decline.open}
      </FormButton>
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
        {length} of {REASON_MAX} characters
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
