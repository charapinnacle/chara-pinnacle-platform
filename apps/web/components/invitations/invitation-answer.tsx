"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
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
type AnswerProps = InvitationAnswerProps & { respondHref: string };

// Accept or decline an invitation that has no answer yet (FR-O1 step Answer, AC8), for any member of the invited
// company. Both are final, so each is confirmed in a dialog: Accept then opens the response form (AC8); Decline asks for an
// optional reason (up to 500 characters, shown to the employer) and the page is drawn again with the new status.
export function InvitationAnswer({ slug, invitationId, employerName, respondHref }: AnswerProps) {
  const [answering, setAnswering] = useState<"accepted" | "declined" | null>(null);
  const close = () => setAnswering(null);
  return (
    <section aria-labelledby="invitation-answer-heading" className="grid gap-3">
      <h2 id="invitation-answer-heading" className="text-h2">
        Your answer
      </h2>
      <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
        {employerName} sees whether your company accepts or declines. An answer cannot be changed.
      </p>
      <div className="flex flex-wrap gap-3">
        <FormButton type="button" className="w-auto" onClick={() => setAnswering("accepted")}>
          Accept
        </FormButton>
        <FormButton type="button" variant="secondary" className="w-auto" onClick={() => setAnswering("declined")}>
          Decline
        </FormButton>
      </div>
      <ModalDialog open={answering !== null} onClose={close} title={answering === "accepted" ? "Accept this invitation?" : "Decline this invitation?"}>
        {answering === "accepted" ? (
          <AcceptConfirmation slug={slug} invitationId={invitationId} employerName={employerName} respondHref={respondHref} onClose={close} />
        ) : (
          <DeclineForm slug={slug} invitationId={invitationId} employerName={employerName} onClose={close} />
        )}
      </ModalDialog>
    </section>
  );
}

export function AcceptConfirmation({ slug, invitationId, employerName, respondHref, onClose }: AnswerProps & { onClose: () => void }) {
  const accept = useActionCall("The invitation was not accepted");
  const router = useRouter();
  return (
    <>
      <p className="text-body leading-relaxed">
        This is final: {employerName} sees that your company accepted, and the invitation can no longer be declined. You
        then write your response to the requirement.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton
          type="button"
          busy={accept.pending}
          onClick={() =>
            accept.run(
              async () => {
                const result = await answerInvitation(slug, { invitationId, answer: "accepted", reason: "" });
                if (result.done) router.push(respondHref);
                return result;
              },
              "You accepted the invitation",
              onClose,
            )
          }
        >
          {accept.pending ? "Accepting" : "Accept invitation"}
        </FormButton>
      </div>
    </>
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
