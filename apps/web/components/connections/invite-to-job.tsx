"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { inviteToJob } from "@/lib/actions/connection-actions";
import { formatCount } from "@/lib/i18n/format";
import { characters } from "@/lib/utils";
import {
  NOTE_MAX,
  jobInvitationFormSchema,
  type JobInvitationFormInput,
  type JobInvitationFormOutput,
} from "@/lib/validation/connection-actions";

const IDS = { jobId: "invite-job", body: "invite-body" };

type InviteToJobProps = {
  slug: string;
  // The conversation with the worker, or the accepted contact request whose conversation is opened first.
  target: { conversationId: string } | { contactRequestId: string };
  // Names the worker for assistive technology; a Find Workers page holds many such buttons.
  workerLabel: string;
  vacancies: readonly { id: string; title: string }[];
};

// "Invite to job" (FR-P2 AC4; SOP step Invite to job): an invitation to apply to one of the organisation's open vacancies,
// sent as a typed message in the conversation with the worker, who then sees an Apply button.
export function InviteToJob(props: InviteToJobProps) {
  const [open, setOpen] = useState(false);
  if (props.vacancies.length === 0) return null;
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        Invite to job<span className="sr-only">: {props.workerLabel}</span>
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title="Invite to apply to a vacancy">
        <InviteForm {...props} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function InviteForm({ slug, target, vacancies, onClose }: InviteToJobProps & { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const form = useForm<JobInvitationFormInput, undefined, JobInvitationFormOutput>({
    resolver: zodResolver(jobInvitationFormSchema),
    defaultValues: { jobId: "", body: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The invitation was not sent" });
  const length = characters(useWatch({ control, name: "body" }));

  function onSubmit(values: JobInvitationFormOutput) {
    return submit(
      () => inviteToJob(slug, target, values, pathname),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({ title: "Invitation sent", description: "The worker can apply from the conversation." });
        if (result.done.href === pathname) router.refresh();
        else router.push(result.done.href);
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={IDS} />
      <p className="text-body leading-relaxed">
        The worker sees the vacancy with an Apply button. Applying works as for any vacancy: the worker chooses what to share.
      </p>
      <SelectField
        control={control}
        name="jobId"
        id={IDS.jobId}
        label="Vacancy"
        placeholder="Select an open vacancy"
        options={vacancies.map(({ id, title }) => ({ value: id, label: title }))}
      />
      <TextareaField
        control={control}
        name="body"
        id={IDS.body}
        label="Message (optional)"
        description={`${formatCount(length)}/${formatCount(NOTE_MAX)} characters`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          Send invitation
        </FormButton>
      </div>
    </form>
  );
}
