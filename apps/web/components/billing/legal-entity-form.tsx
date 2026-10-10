"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { saveLegalEntityIdentifier } from "@/lib/actions/billing";
import { oneTrialRule } from "@/lib/billing/presentation";
import { legalEntityFormSchema, type LegalEntityFormInput } from "@/lib/validation/billing";
import { identifierKindOptions } from "@/lib/validation/organization";

const ids = { identifier: "legal-entity-identifier", identifierKind: "legal-entity-identifier-kind" } as const;

// The owner records or corrects the identifier that decides the free trial, until a payment has been started.
export function LegalEntityForm({ slug, defaults }: { slug: string; defaults: LegalEntityFormInput }) {
  const form = useForm<LegalEntityFormInput>({
    resolver: zodResolver(legalEntityFormSchema),
    defaultValues: defaults,
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "Could not save the identifier" });

  function onSubmit(values: LegalEntityFormInput) {
    return submit(
      () => saveLegalEntityIdentifier(slug, values),
      (result) => {
        if (result.message) toastError("Could not save the identifier", result.message);
        else if (!result.errors) toast({ title: "Identifier saved" });
      },
    );
  }

  return (
    <form noValidate className="grid gap-5" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      <InputField
        control={control}
        name="identifier"
        id={ids.identifier}
        label="Company registration number or VAT number"
        description={oneTrialRule}
        autoComplete="off"
      />
      <SelectField
        control={control}
        name="identifierKind"
        id={ids.identifierKind}
        label="Type of identifier"
        placeholder="Choose a type"
        options={identifierKindOptions}
      />
      <FormButton type="submit" variant="secondary" busy={formState.isSubmitting} className="w-full sm:w-auto">
        {formState.isSubmitting ? "Saving..." : "Save identifier"}
      </FormButton>
    </form>
  );
}
