"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { submitCandidate } from "@/lib/actions/submissions";
import type { OrganizationType, UsagePrompt } from "@/lib/billing/limits";
import { formatCount } from "@/lib/i18n/format";
import { characters } from "@/lib/utils";
import {
  CANDIDATE_EMAIL_MAX,
  SUBMISSION_NOTE_MAX,
  submitCandidateFormSchema,
  type SubmitCandidateFormInput,
  type SubmitCandidateFormOutput,
} from "@/lib/validation/submission";

const ids = { email: "submission-email", note: "submission-note" } as const;

type SubmitCandidateFormProps = {
  slug: string;
  requirementId: string;
  organization: { id: string; type: OrganizationType; canManage: boolean };
  billingHref: string;
  // The id of the reason the request cannot be sent now (an outdated commitment): Send request is disabled and described
  // by it.
  blockedBy?: string;
};

// The partner's request to a candidate (FR-O4 step Request, AC12): the address and an optional note the candidate reads
// (and the employer after the approval). The answer is "Request sent" whatever the address is (AC2); the form is then
// emptied for the next candidate. A double press sends one request: the second waits for the first, and the database
// answers the same address with the request already sent.
export function SubmitCandidateForm({ slug, requirementId, organization, billingHref, blockedBy }: SubmitCandidateFormProps) {
  const form = useForm<SubmitCandidateFormInput, undefined, SubmitCandidateFormOutput>({
    resolver: zodResolver(submitCandidateFormSchema),
    defaultValues: { email: "", note: "" },
  });
  const [limitReached, setLimitReached] = useState<UsagePrompt | null>(null);
  const { control, formState, handleSubmit, reset } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The request was not sent" });
  const noteLength = characters(useWatch({ control, name: "note" }));

  function onValid(values: SubmitCandidateFormOutput) {
    setLimitReached(null);
    return submit(
      () => submitCandidate(slug, requirementId, values),
      (result) => {
        if (result.limitReached) setLimitReached(result.limitReached);
        const [first] = Object.keys(result.errors ?? {});
        if (first) form.setFocus(first as FieldPath<SubmitCandidateFormInput>);
        if (!result.sent) return;
        reset();
        toast({
          title: "Request sent",
          description: result.sent.existing ? "A request to this address was already waiting for the candidate's answer." : undefined,
        });
      },
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onValid)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      <InputField
        control={control}
        name="email"
        id={ids.email}
        type="email"
        autoComplete="off"
        label="Candidate's email address"
        description={`The candidate receives the request at this address and answers it in their worker account. Up to ${formatCount(CANDIDATE_EMAIL_MAX)} characters.`}
      />
      <TextareaField
        control={control}
        name="note"
        id={ids.note}
        label="Note to the candidate (optional)"
        description={`The candidate reads the note, and the employer too once the candidate approves. ${formatCount(noteLength)}/${formatCount(SUBMISSION_NOTE_MAX)}`}
      />
      {limitReached ? (
        <Notice tone="warning" role="status">
          <UpgradePrompt
            organizationId={organization.id}
            organizationType={organization.type}
            prompt={limitReached}
            billingHref={billingHref}
            canUpgrade={organization.canManage}
            focusUpgrade
          />
        </Notice>
      ) : null}
      <FormButton
        type="submit"
        className="w-auto justify-self-start"
        busy={formState.isSubmitting}
        disabled={blockedBy !== undefined}
        aria-describedby={blockedBy}
      >
        {formState.isSubmitting ? "Sending" : "Send request"}
      </FormButton>
    </form>
  );
}
