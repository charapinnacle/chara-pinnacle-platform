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
import { answerInvitation } from "@/lib/actions/invitations";
import { DECLINE_REASON_MAX, declineFormSchema, type DeclineFormInput, type DeclineFormOutput } from "@/lib/validation/invitation";

const REASON_ID = "decline-reason";

type InvitationAnswerProps = { slug: string; invitationId: string; employerName: string };

// Accept or decline an invitation that has no answer yet (FR-O1 step Answer, AC8), for any member of the invited
// company. Accept answers at once; Decline asks for an optional reason (up to 500 characters, shown to the employer) and
// is confirmed in the dialog. Both are final, and the page is drawn again with the new status.
export function InvitationAnswer({ slug, invitationId, employerName }: InvitationAnswerProps) {
  const [declining, setDeclining] = useState(false);
  const accept = useActionCall("The invitation was not accepted");
  const close = () => setDeclining(false);
  return (
    <section aria-labelledby="invitation-answer-heading" className="grid gap-3">
      <h2 id="invitation-answer-heading" className="text-h2">
        Your answer
      </h2>
      <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
        {employerName} sees whether your company accepts or declines. An answer cannot be changed.
      </p>
      <div className="flex flex-wrap gap-3">
        <FormButton
          type="button"
          className="w-auto"
          busy={accept.pending}
          disabled={accept.pending}
          onClick={() => accept.run(() => answerInvitation(slug, { invitationId, answer: "accepted", reason: "" }), "You accepted the invitation")}
        >
          Accept
        </FormButton>
        <FormButton type="button" variant="secondary" className="w-auto" disabled={accept.pending} onClick={() => setDeclining(true)}>
          Decline
        </FormButton>
      </div>
      <ModalDialog open={declining} onClose={close} title="Decline this invitation?">
        <DeclineForm slug={slug} invitationId={invitationId} employerName={employerName} onClose={close} />
      </ModalDialog>
    </section>
  );
}

function DeclineForm({ slug, invitationId, employerName, onClose }: InvitationAnswerProps & { onClose: () => void }) {
  const form = useForm<DeclineFormInput, undefined, DeclineFormOutput>({
    resolver: zodResolver(declineFormSchema),
    defaultValues: { reason: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The invitation was not declined" });
  const length = useWatch({ control, name: "reason" }).length;

  function onSubmit(values: DeclineFormOutput) {
    return submit(
      () => answerInvitation(slug, { invitationId, answer: "declined", reason: values.reason }),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({ title: "You declined the invitation" });
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ reason: REASON_ID }} />
      <p className="text-body leading-relaxed">
        This is final: your company can no longer respond to this requirement through the invitation.
      </p>
      <TextareaField
        control={control}
        name="reason"
        id={REASON_ID}
        label="Reason (optional)"
        description={`${employerName} reads the reason. ${length}/${DECLINE_REASON_MAX}`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" variant="destructive" busy={formState.isSubmitting}>
          Decline invitation
        </FormButton>
      </div>
    </form>
  );
}
