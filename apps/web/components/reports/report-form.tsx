"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { cardVariants } from "@/components/layout/card";
import { submitReport } from "@/lib/actions/reports";
import { characters, cn } from "@/lib/utils";
import {
  DETAILS_MAX_CHARS,
  reportCategoryOptions,
  reportFormSchemaFor,
  type ReportFormInput,
  type ReportInput,
} from "@/lib/validation/report";
import { BRAND_NAME } from "@/lib/brand";

type ReportFormProps = {
  lang: string;
  type: ReportInput["type"];
  // The vacancy, application or path when the page already knows it; the person then has no link to give.
  target?: string;
  signedIn: boolean;
};

const ids = {
  link: "report-link",
  category: "report-category",
  details: "report-details",
  email: "report-email",
  goodFaith: "report-good-faith",
} as const satisfies Record<keyof ReportFormInput, string>;

const linkLabels = {
  job: { label: "Address of the vacancy", description: "Paste the address of the vacancy page." },
  company: { label: "Address of one of its vacancies", description: "Paste the address of a vacancy page of the company." },
  content: { label: "Address of the page", description: `A page of ${BRAND_NAME}, for example /en/pricing.` },
  profile: { label: "", description: "" },
} as const;

const FAILURE = "The report was not sent";

// What a member writes about an applicant reaches Trust & Safety as typed, so the form says what to leave out.
const PROFILE_ADVICE = "Do not write the candidate's name, contact details or documents; describe the behaviour only.";

// One form for every kind of report: the page decides the kind and whether the target is known. The database checks
// that the target can be reported, and by whom, again.
export function ReportForm({ lang, type, target, signedIn }: ReportFormProps) {
  const form = useForm<ReportFormInput>({
    resolver: zodResolver(reportFormSchemaFor(type, target !== undefined)),
    defaultValues: { link: "", category: "", details: "", email: "", goodFaith: false },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: FAILURE });
  const length = characters(useWatch({ control, name: "details" }));
  const [reference, setReference] = useState<string | null>(null);
  const received = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reference) received.current?.focus();
  }, [reference]);

  function onSubmit(values: ReportFormInput) {
    return submit(
      () => submitReport({ type, target: target ?? values.link, category: values.category, details: values.details, email: signedIn ? "" : values.email, goodFaith: values.goodFaith }),
      (result) => {
        if (result.reference) setReference(result.reference);
      },
    );
  }

  if (reference) {
    return (
      <div ref={received} tabIndex={-1} role="status" className={cn(cardVariants({ padding: "lg", elevated: true }), "outline-none")}>
        <h2 className="text-h2">Your report was received</h2>
        <p className="text-body">
          Your reference number is <strong className="font-mono">{reference}</strong>.
        </p>
        {signedIn ? (
          <p className="text-body text-muted-foreground">
            You are told here when it is closed, with the outcome and a note. <TextLink href={`/${lang}/reports`}>See your reports</TextLink>
          </p>
        ) : (
          <p className="text-body text-muted-foreground">
            Keep this number. We do not email you about it, and a report cannot be looked up without an account.
          </p>
        )}
        <TextLink standalone href={`/${lang}/trust-safety`}>
          Back to Trust &amp; Safety
        </TextLink>
      </div>
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      {target === undefined ? (
        <InputField control={control} name="link" id={ids.link} autoComplete="off" {...linkLabels[type]} />
      ) : null}
      <SelectField
        control={control}
        name="category"
        id={ids.category}
        label="What is wrong"
        placeholder="Choose a category"
        options={reportCategoryOptions}
      />
      <TextareaField
        control={control}
        name="details"
        id={ids.details}
        label="What happened"
        description={`20 to ${DETAILS_MAX_CHARS} characters. ${type === "profile" ? PROFILE_ADVICE : "Do not include passwords or documents."} ${length}/${DETAILS_MAX_CHARS}`}
      />
      {signedIn ? null : (
        <InputField
          control={control}
          name="email"
          id={ids.email}
          label="Your email (optional)"
          type="email"
          autoComplete="email"
          description="Only so that we can ask you a question about this report. We send nothing to it automatically."
        />
      )}
      <CheckboxField control={control} name="goodFaith" id={ids.goodFaith}>
        I confirm that this report is accurate to the best of my knowledge and that I am sending it in good faith.
      </CheckboxField>
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Sending..." : "Send report"}
      </FormButton>
    </form>
  );
}
