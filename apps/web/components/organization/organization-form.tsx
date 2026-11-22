"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toastError } from "@/components/feedback/toast-store";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { StepCard } from "@/components/onboarding/step-card";
import { partnerTypeLabels } from "@/components/forms/account-kind-options";
import { createOrganization, createPartnerOrganization } from "@/lib/actions/organizations";
import { identifierPurpose } from "@/lib/billing/presentation";
import type { ReferenceItem } from "@/lib/dal/reference";
import { characterCount } from "@/lib/i18n/format";
import { toOptions } from "@/lib/reference-options";
import { onboardingPath } from "@/lib/routes";
import {
  DESCRIPTION_MAX_CHARS,
  identifierKindOptions,
  companyStepSchema,
  type PartnerOrganizationFormInput,
} from "@/lib/validation/organization";
import type { PartnerType } from "@/lib/validation/sign-up";
import { BRAND_NAME } from "@/lib/brand";

type OrganizationFormProps = {
  lang: string;
  countries: ReferenceItem[];
  industries: ReferenceItem[];
  defaultCountry: string;
  partnerType?: PartnerType;
};

const IDENTIFIER_HELP = `${identifierPurpose} 4 to 32 letters and digits, for example DE123456789 (VAT) or HRB12345 (company register); spaces, dots, hyphens and slashes are ignored.`;

const PARTNER_IDENTIFIER_HELP = "Our team checks it before your company is listed. 4 to 32 letters and digits, for example DE123456789 (VAT) or HRB12345 (company register); spaces, dots, hyphens and slashes are ignored.";

const ids = {
  legalName: "org-legal-name",
  displayName: "org-display-name",
  country: "org-country",
  industry: "org-industry",
  website: "org-website",
  identifier: "org-identifier",
  identifierKind: "org-identifier-kind",
  description: "org-description",
} as const satisfies Record<keyof PartnerOrganizationFormInput, string>;

const groupTitleClassName = "mb-5 text-eyebrow text-muted-foreground uppercase";

// The Company step of onboarding. An employer registers as in Phase 1; with partnerType a recruitment or staffing
// company (FR-J1) registers the type it chose at sign-up, which is shown and cannot be changed, with the identifier
// required and the description asked at once.
export function OrganizationForm({ lang, countries, industries, defaultCountry, partnerType }: OrganizationFormProps) {
  const form = useForm<PartnerOrganizationFormInput>({
    resolver: zodResolver(companyStepSchema(partnerType !== undefined)),
    defaultValues: {
      legalName: "",
      displayName: "",
      country: defaultCountry,
      industry: "",
      website: "",
      identifier: "",
      identifierKind: "",
      description: "",
    },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const descriptionLength = useWatch({ control, name: "description" }).length;
  const [duplicateLegalName, setDuplicateLegalName] = useState(false);
  const { summaryRef, submit } = useServerFormSubmit(form, {
    failureTitle: "Could not create the company",
  });

  function onSubmit() {
    return submit(
      () => {
        const { description, ...values } = form.getValues();
        return partnerType ? createPartnerOrganization({ ...values, description }) : createOrganization(values);
      },
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
          An organisation with a similar name already exists on {BRAND_NAME}.
        </Notice>
        <TextLink standalone href={partnerType ? onboardingPath(lang) : onboardingPath(lang, "security")}>
          Continue
        </TextLink>
      </div>
    );
  }

  const legalName = (
    <InputField control={control} name="legalName" id={ids.legalName} label="Legal company name" autoComplete="organization" />
  );
  const displayName = (
    <InputField
      control={control}
      name="displayName"
      id={ids.displayName}
      label="Display name (optional)"
      description={
        partnerType
          ? "The name employers and other companies see. Defaults to the legal name."
          : "The name candidates see. Defaults to the legal name."
      }
    />
  );
  const country = (
    <ComboboxField
      control={control}
      name="country"
      id={ids.country}
      label={partnerType ? "Country where you are based" : "Country"}
      placeholder="Choose a country"
      options={toOptions(countries)}
    />
  );
  const industry = (
    <ComboboxField
      control={control}
      name="industry"
      id={ids.industry}
      label="Industry"
      placeholder="Choose an industry"
      options={toOptions(industries)}
    />
  );
  const website = (
    <InputField control={control} name="website" id={ids.website} label="Website (optional)" type="url" autoComplete="url" />
  );
  const description = (
    <TextareaField
      control={control}
      name="description"
      id={ids.description}
      label="About your company (optional)"
      description={`Plain text: what you do and for whom. Line breaks are kept. ${characterCount(descriptionLength, DESCRIPTION_MAX_CHARS)}.`}
    />
  );
  const identifier = (
    <InputField
      control={control}
      name="identifier"
      id={ids.identifier}
      label={
        partnerType
          ? "Company registration number, VAT number or other identifier"
          : "Company registration number or VAT number (optional until you start your trial)"
      }
      description={partnerType ? PARTNER_IDENTIFIER_HELP : IDENTIFIER_HELP}
    />
  );
  const identifierKind = (
    <SelectField
      control={control}
      name="identifierKind"
      id={ids.identifierKind}
      label="Type of identifier"
      placeholder="Choose a type"
      options={identifierKindOptions}
    />
  );

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      {partnerType ? (
        <>
          <StepCard
            title="Company details"
            hint={
              <>
                Company type: <strong className="font-semibold text-foreground">{partnerTypeLabels[partnerType]}</strong>. You
                chose it when you signed up; only our team can correct it.
              </>
            }
            columns
          >
            {legalName}
            {displayName}
            {country}
            {industry}
            <div className="sm:col-span-2">{website}</div>
            <div className="sm:col-span-2">{description}</div>
          </StepCard>
          <StepCard title="Registration" columns>
            {identifier}
            {identifierKind}
          </StepCard>
        </>
      ) : (
        <>
          <fieldset className="grid min-w-0 gap-6">
            <legend className={groupTitleClassName}>Company</legend>
            {legalName}
            {displayName}
            {country}
            {industry}
            {website}
          </fieldset>
          <div className="border-t pt-8">
            <fieldset className="grid min-w-0 gap-6">
              <legend className={groupTitleClassName}>Registration</legend>
              {identifier}
              {identifierKind}
            </fieldset>
          </div>
        </>
      )}
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Creating company..." : "Continue"}
      </FormButton>
    </form>
  );
}
