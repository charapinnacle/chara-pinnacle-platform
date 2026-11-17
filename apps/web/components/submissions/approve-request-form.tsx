"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { CheckboxGroupField } from "@/components/forms/checkbox-group-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { approveSubmission } from "@/lib/actions/submissions";
import type { ApplyDocument } from "@/lib/dal/applications";
import { approveFormSchema, type ApproveFormInput, type ApproveFormOutput } from "@/lib/validation/submission";

const ids = { documentIds: "approve-documents", consent: "approve-consent" } as const;

type ApproveRequestFormProps = {
  lang: string;
  submissionId: string;
  // Who receives the profile: the employer's name when it shows it, otherwise the employer of the requirement.
  recipient: string;
  documents: ApplyDocument[];
  documentsMax: number;
};

// The candidate approves the request (FR-O4 step Approve, AC5): what will be shared is listed before the approval, the
// documents are the candidate's choice (none is allowed: the employer then reads the profile only), and the consent to
// the sharing notice for this submission is the confirmation (NFR-C4).
export function ApproveRequestForm({ lang, submissionId, recipient, documents, documentsMax }: ApproveRequestFormProps) {
  const schema = useMemo(() => approveFormSchema(documentsMax), [documentsMax]);
  const form = useForm<ApproveFormInput, undefined, ApproveFormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { documentIds: [], consent: false },
  });
  const [missing, setMissing] = useState<{ label: string; section: string }[]>([]);
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The request was not approved" });

  function onValid(values: ApproveFormOutput) {
    setMissing([]);
    return submit(
      () => approveSubmission(submissionId, values),
      (result) => {
        setMissing(result.missing ?? []);
        if (result.done) toast({ title: "Request approved", description: `${recipient} can now read your profile.` });
      },
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onValid)}>
      <FormErrorSummary
        form={form}
        summaryRef={summaryRef}
        ids={ids}
        action={
          missing.length > 0 ? (
            <ul role="list" className="grid">
              {missing.map(({ label, section }) => (
                <li key={label}>
                  <TextLink tone="destructive" className="block py-2" href={`/${lang}/passport#${section}`}>
                    {label}
                  </TextLink>
                </li>
              ))}
            </ul>
          ) : null
        }
      />

      <div className="grid gap-2">
        <h3 className="text-h3">What will be shared</h3>
        <ul className="grid list-disc gap-1 ps-5 text-body">
          <li>Your profile: name, country, occupation, experience, skills, languages, availability and work authorisations</li>
          <li>Only the documents you select below</li>
        </ul>
        <p className="text-body text-muted-foreground">Your email address and your other documents are not shared.</p>
      </div>

      {documents.length > 0 ? (
        <CheckboxGroupField
          control={control}
          name="documentIds"
          id={ids.documentIds}
          legend="Documents to share (optional)"
          options={documents.map(({ id, title }) => ({ value: id, label: title }))}
        />
      ) : (
        <p className="text-body">
          You have no documents yet. You can still approve, or <TextLink href={`/${lang}/passport#documents`}>add documents first</TextLink>.
        </p>
      )}

      <CheckboxField
        control={control}
        name="consent"
        id={ids.consent}
        accessibleName={`I agree to share my profile and the selected documents with ${recipient} for this submission, as the sharing notice describes`}
      >
        <span>
          I agree to share my profile and the selected documents with {recipient} for this submission, as the{" "}
          <TextLink href={`/${lang}/legal/sharing-notice`} className="relative z-10">
            sharing notice
          </TextLink>{" "}
          describes
        </span>
      </CheckboxField>

      <FormButton type="submit" className="w-auto justify-self-start" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Approving" : "Approve and share"}
      </FormButton>
    </form>
  );
}
