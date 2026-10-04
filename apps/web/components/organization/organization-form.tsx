"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { createOrganization } from "@/lib/actions/organizations";
import type { ReferenceItem } from "@/lib/dal/reference";
import { defaultLocale } from "@/lib/i18n/locale";
import { mfaPath } from "@/lib/routes";
import {
  identifierKindOptions,
  organizationFormSchema,
  type OrganizationFormInput,
} from "@/lib/validation/organization";

type OrganizationFormProps = {
  countries: ReferenceItem[];
  industries: ReferenceItem[];
};

const ids = {
  legalName: "org-legal-name",
  displayName: "org-display-name",
  country: "org-country",
  industry: "org-industry",
  website: "org-website",
  identifierKind: "org-identifier-kind",
  identifier: "org-identifier",
} as const satisfies Record<keyof OrganizationFormInput, string>;

function toOptions(items: readonly ReferenceItem[]) {
  return items.map((item) => ({ value: item.code, label: item.name }));
}

export function OrganizationForm({ countries, industries }: OrganizationFormProps) {
  const form = useForm<OrganizationFormInput>({
    resolver: zodResolver(organizationFormSchema),
    defaultValues: {
      legalName: "",
      displayName: "",
      country: "",
      industry: "",
      website: "",
      identifierKind: "",
      identifier: "",
    },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const [duplicateLegalName, setDuplicateLegalName] = useState(false);
  const { summaryRef, submit } = useServerFormSubmit(form, {
    failureTitle: "Could not create the company",
  });

  const items: ErrorSummaryItem[] = [
    ...(Object.keys(ids) as (keyof typeof ids)[]).flatMap((name) => {
      const error = formState.errors[name];
      return error ? [{ key: name, message: String(error.message), targetId: ids[name] }] : [];
    }),
    ...(formState.errors.root?.server
      ? [{ key: "root", message: String(formState.errors.root.server.message) }]
      : []),
  ];

  function onSubmit() {
    return submit(
      () => createOrganization(form.getValues()),
      (result) => setDuplicateLegalName(Boolean(result.created?.duplicateLegalName)),
    );
  }

  if (duplicateLegalName) {
    return (
      <div className="grid gap-4">
        <Notice tone="info" role="status">
          Your company was created. Another company on CHARA uses the same legal name, and we have noted
          the overlap.
        </Notice>
        <TextLink standalone href={mfaPath(defaultLocale)}>
          Continue
        </TextLink>
      </div>
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onSubmit)}>
      <ErrorSummary
        ref={summaryRef}
        items={items}
        onSelect={(key) => form.setFocus(key as FieldPath<OrganizationFormInput>)}
      />
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
      <SelectField
        control={control}
        name="country"
        id={ids.country}
        label="Country"
        placeholder="Choose a country"
        options={toOptions(countries)}
      />
      <SelectField
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
      <SelectField
        control={control}
        name="identifierKind"
        id={ids.identifierKind}
        label="Type of legal-entity identifier (optional)"
        placeholder="Choose a type"
        options={identifierKindOptions}
      />
      <InputField
        control={control}
        name="identifier"
        id={ids.identifier}
        label="Legal-entity identifier (optional)"
        description="Needed before you start a free trial, which is granted once per legal entity. You can add it later."
      />
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Creating company..." : "Create company"}
      </FormButton>
    </form>
  );
}
