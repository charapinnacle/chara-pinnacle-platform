"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldPath } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
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

  const items: ErrorSummaryItem[] = [
    ...(Object.keys(ids) as (keyof typeof ids)[]).flatMap((name) => {
      const error = formState.errors[name];
      return error ? [{ key: name, message: String(error.message), targetId: ids[name] }] : [];
    }),
    ...(formState.errors.root?.server ? [{ key: "root", message: String(formState.errors.root.server.message) }] : []),
  ];

  function onSubmit(values: LegalEntityFormInput) {
    return submit(
      () => saveLegalEntityIdentifier(slug, values),
      (result) => {
        if (result.message) toast({ variant: "error", title: "Could not save the identifier", description: result.message });
        else if (!result.errors) toast({ title: "Identifier saved" });
      },
    );
  }

  return (
    <form noValidate className="grid gap-5" onSubmit={handleSubmit(onSubmit)}>
      <ErrorSummary
        ref={summaryRef}
        items={items}
        onSelect={(key) => form.setFocus(key as FieldPath<LegalEntityFormInput>)}
      />
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
