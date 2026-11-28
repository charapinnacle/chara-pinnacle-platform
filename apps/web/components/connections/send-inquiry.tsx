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
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { sendInquiry } from "@/lib/actions/connection-actions";
import { characterCount } from "@/lib/i18n/format";
import { characters } from "@/lib/utils";
import { INQUIRY_MAX, inquiryFormSchema, type InquiryFormInput, type InquiryFormOutput } from "@/lib/validation/connection-actions";

const BODY_ID = "inquiry-body";

type SendInquiryProps = {
  // The employer, or since D91 the partner company, the inquiry is sent for.
  slug: string;
  senderName: string;
  partnerId: string;
  partnerName: string;
  // The button's words: "Send inquiry" for an employer, "Contact this company" for another partner.
  label?: string;
};

// "Send inquiry" on a partner's public profile (FR-P2 AC1, AC9; SOP step Send inquiry; D91 for another partner): a short
// inquiry that opens, or continues, the conversation of the sender with the partner, where the sender is then taken.
export function SendInquiry(props: SendInquiryProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FormButton type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        {props.label ?? "Send inquiry"}
        <span className="sr-only normal-case"> to {props.partnerName}</span>
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title={`Send an inquiry to ${props.partnerName}`}>
        <InquiryForm {...props} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function InquiryForm({ slug, senderName, partnerId, partnerName, onClose }: SendInquiryProps & { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [existingHref, setExistingHref] = useState<string | null>(null);
  const form = useForm<InquiryFormInput, undefined, InquiryFormOutput>({
    resolver: zodResolver(inquiryFormSchema),
    defaultValues: { body: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The inquiry was not sent" });
  const length = characters(useWatch({ control, name: "body" }));

  function onSubmit(values: InquiryFormOutput) {
    return submit(
      () => sendInquiry(slug, partnerId, values, pathname),
      (result) => {
        setExistingHref(result.existingHref ?? null);
        if (!result.done) return;
        onClose();
        toast({ title: "Inquiry sent", description: `${partnerName} can reply in the conversation.` });
        router.push(result.done.href);
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ body: BODY_ID }} />
      {existingHref ? (
        <p>
          <TextLink href={existingHref}>Open the conversation with {partnerName}</TextLink>
        </p>
      ) : null}
      <p className="text-body leading-relaxed">
        {partnerName} sees {senderName}&apos;s name and your inquiry, and answers in a conversation. An inquiry counts as one
        message of your plan.
      </p>
      <TextareaField
        control={control}
        name="body"
        id={BODY_ID}
        label="Your inquiry"
        description={`${characterCount(length, INQUIRY_MAX)}`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          Send inquiry
        </FormButton>
      </div>
    </form>
  );
}
