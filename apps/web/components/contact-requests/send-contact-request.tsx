"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { sendContactRequest } from "@/lib/actions/contact-requests";
import { CONTACT_MESSAGE_MAX } from "@/lib/contact-requests/presentation";
import { formatCount } from "@/lib/i18n/format";
import { characters } from "@/lib/utils";
import {
  contactRequestFormSchema,
  type ContactRequestFormInput,
  type ContactRequestFormOutput,
} from "@/lib/validation/contact-request";

const MESSAGE_ID = "contact-request-message";
const JOB_ID = "contact-request-job";

type SendContactRequestProps = {
  slug: string;
  cardId: string;
  // Names the card for assistive technology, which hears many Send buttons on one page.
  cardLabel: string;
  vacancies: readonly { id: string; title: string }[];
};

// "Send contact request" on a Find Workers card (FR-Q3 AC12, SOP step Send): a short message and, for an employer, one of
// its open vacancies. The worker sees the organisation; the worker's name reaches it only if the worker accepts.
export function SendContactRequest({ slug, cardId, cardLabel, vacancies }: SendContactRequestProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <FormButton type="button" className="w-auto" aria-label={`Send contact request: ${cardLabel}`} onClick={() => setOpen(true)}>
        Send contact request
      </FormButton>
      <ModalDialog open={open} onClose={close} title="Send a contact request">
        <SendForm slug={slug} cardId={cardId} vacancies={vacancies} onClose={close} />
      </ModalDialog>
    </>
  );
}

function SendForm({ slug, cardId, vacancies, onClose }: Omit<SendContactRequestProps, "cardLabel"> & { onClose: () => void }) {
  const form = useForm<ContactRequestFormInput, undefined, ContactRequestFormOutput>({
    resolver: zodResolver(contactRequestFormSchema),
    defaultValues: { message: "", jobId: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The contact request was not sent" });
  const length = characters(useWatch({ control, name: "message" }));

  function onSubmit(values: ContactRequestFormOutput) {
    return submit(
      () => sendContactRequest(slug, cardId, values),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({ title: "Contact request sent", description: "The worker decides whether to share their name with you." });
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ message: MESSAGE_ID, jobId: JOB_ID }} />
      <p className="text-body leading-relaxed">
        The worker sees your organisation&apos;s name and your message. Their name is shared with you only if they accept, and
        documents only if they later apply or share them.
      </p>
      <TextareaField
        control={control}
        name="message"
        id={MESSAGE_ID}
        label="Message to the worker"
        description={`${formatCount(length)}/${formatCount(CONTACT_MESSAGE_MAX)} characters`}
      />
      {vacancies.length > 0 ? (
        <SelectField
          control={control}
          name="jobId"
          id={JOB_ID}
          label="Invite to apply to a vacancy (optional)"
          placeholder="No vacancy"
          options={vacancies.map(({ id, title }) => ({ value: id, label: title }))}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          Send request
        </FormButton>
      </div>
    </form>
  );
}
