"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toastError } from "@/components/feedback/toast-store";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { createOrganization } from "@/lib/actions/organizations";
import { oneTrialRule } from "@/lib/billing/presentation";
import type { ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import { mfaPath } from "@/lib/routes";
import {
  identifierKindOptions,
  organizationFormSchema,
  type OrganizationFormInput,
} from "@/lib/validation/organization";

type OrganizationFormProps = {
  lang: string;
  countries: ReferenceItem[];
  industries: ReferenceItem[];
};

const ids = {
  legalName: "org-legal-name",
  displayName: "org-display-name",
  country: "org-country",
  industry: "org-industry",
  website: "org-website",
  identifier: "org-identifier",
  identifierKind: "org-identifier-kind",
} as const satisfies Record<keyof OrganizationFormInput, string>;

export function OrganizationForm({ lang, countries, industries }: OrganizationFormProps) {
  const form = useForm<OrganizationFormInput>({
    resolver: zodResolver(organizationFormSchema),
    defaultValues: {
      legalName: "",
      displayName: "",
      country: "",
      industry: "",
      website: "",
      identifier: "",
      identifierKind: "",
    },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const [duplicateLegalName, setDuplicateLegalName] = useState(false);
  const { summaryRef, submit } = useServerFormSubmit(form, {
    failureTitle: "Could not create the company",
  });

  function onSubmit() {
    return submit(
      () => createOrganization(form.getValues()),
      (result) => {
        setDuplicateLegalName(Boolean(result.duplicateLegalName));
        if (result.message) {
          toastError("Could not create the company", result.message);
        }
      },
    );
  }

  if (duplicateLegalName) {
    return (
      <div className="grid gap-4">
        <p className="text-body">Your company was created.</p>
        <Notice tone="info" role="status">
          An organisation with a similar name already exists on CHARA.
        </Notice>
        <TextLink standalone href={mfaPath(lang)}>
          Continue
        </TextLink>
      </div>
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      <InputField
        control={control}
        name="legalName"
        id={ids.legalName}
        label="Legal company name"
        autoComplete="organization"
      />
      <InputField
        control={control}
        name="displayName"
        id={ids.displayName}
        label="Display name (optional)"
        description="The name candidates see. Defaults to the legal name."
      />
      <ComboboxField
        control={control}
        name="country"
        id={ids.country}
        label="Country"
        placeholder="Choose a country"
        options={toOptions(countries)}
      />
      <ComboboxField
        control={control}
        name="industry"
        id={ids.industry}
        label="Industry"
        placeholder="Choose an industry"
        options={toOptions(industries)}
      />
      <InputField
        control={control}
        name="website"
        id={ids.website}
        label="Website (optional)"
        type="url"
        autoComplete="url"
      />
      <InputField
        control={control}
        name="identifier"
        id={ids.identifier}
        label="Company registration number or VAT number (optional until you start your trial)"
        description={oneTrialRule}
      />
      <SelectField
        control={control}
        name="identifierKind"
        id={ids.identifierKind}
        label="Type of identifier"
        placeholder="Choose a type"
        options={identifierKindOptions}
      />
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Creating company..." : "Create company"}
      </FormButton>
    </form>
  );
}
