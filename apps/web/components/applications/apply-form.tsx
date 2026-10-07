"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { CheckboxGroupField } from "@/components/forms/checkbox-group-field";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { TextareaField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { applyToVacancy } from "@/lib/actions/applications";
import { CROSS_BORDER_NOTICE, NOT_ACCEPTING } from "@/lib/applications/presentation";
import type { ApplyDocument } from "@/lib/dal/applications";
import { applyFormSchema, type ApplyFormInput, type ApplyLimits } from "@/lib/validation/application";

type ApplyFormProps = {
  jobId: string;
  lang: string;
  employerName: string;
  limits: ApplyLimits;
  documents: ApplyDocument[];
};

const ids = { coverNote: "apply-cover-note", documentIds: "apply-documents", consent: "apply-consent" } as const;

export function ApplyForm({ jobId, lang, employerName, limits, documents }: ApplyFormProps) {
  const schema = useMemo(() => applyFormSchema(limits), [limits]);
  const form = useForm<ApplyFormInput>({
    resolver: zodResolver(schema),
    defaultValues: { coverNote: "", documentIds: [], consent: false },
  });
  const [notOpen, setNotOpen] = useState(false);
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "Could not submit your application" });
  const noteLength = useWatch({ control, name: "coverNote" }).length;

  const items: ErrorSummaryItem[] = [
    ...(Object.keys(ids) as (keyof typeof ids)[]).flatMap((name) => {
      const error = formState.errors[name];
      return error ? [{ key: name, message: String(error.message), targetId: ids[name] }] : [];
    }),
    ...(formState.errors.root?.server ? [{ key: "root", message: String(formState.errors.root.server.message) }] : []),
  ];

  function onValid() {
    return submit(
      () => applyToVacancy(jobId, form.getValues()),
      (result) => {
        if (result.notOpen) setNotOpen(true);
        const [first] = Object.keys(result.errors ?? {});
        if (first) form.setFocus(first as FieldPath<ApplyFormInput>);
      },
    );
  }

  if (notOpen) {
    return (
      <Notice tone="error" role="alert" className="grid gap-2">
        <p className="font-semibold">{NOT_ACCEPTING}</p>
        <TextLink standalone href={`/${lang}/jobs`}>
          Find vacancies
        </TextLink>
      </Notice>
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onValid)}>
      <ErrorSummary ref={summaryRef} items={items} onSelect={(key) => form.setFocus(key as FieldPath<ApplyFormInput>)} />

      <TextareaField
        control={control}
        name="coverNote"
        id={ids.coverNote}
        label="Cover note (optional)"
        description={`${noteLength}/${limits.coverNoteMaxChars}`}
      />

      {documents.length > 0 ? (
        <CheckboxGroupField
          control={control}
          name="documentIds"
          id={ids.documentIds}
          legend="Documents to share"
          options={documents.map(({ id, title }) => ({ value: id, label: title }))}
        />
      ) : (
        <p className="text-body">
          You have no documents yet. You can still apply, or{" "}
          <TextLink href={`/${lang}/passport#documents`}>add documents first</TextLink>.
        </p>
      )}

      <CheckboxField control={control} name="consent" id={ids.consent}>
        I agree to share the selected documents with {employerName} for this application
      </CheckboxField>

      <Notice tone="info">{CROSS_BORDER_NOTICE}</Notice>

      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Submitting" : "Submit application"}
      </FormButton>
    </form>
  );
}
