"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { updateOrganizationProfile } from "@/lib/actions/organizations";
import type { ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import { organizationProfileSchema, type OrganizationProfileInput } from "@/lib/validation/organization";

type ProfileFormProps = {
  slug: string;
  defaults: OrganizationProfileInput;
  legalNameLocked: boolean;
  countries: ReferenceItem[];
  industries: ReferenceItem[];
};

const ids = {
  legalName: "org-legal-name",
  displayName: "org-display-name",
  country: "org-country",
  industry: "org-industry",
  website: "org-website",
} as const satisfies Record<keyof OrganizationProfileInput, string>;

const FAILURE = "Could not save the company profile";

// The labels are those of the registration form, so a company finds its details where it entered them.
export function ProfileForm({ slug, defaults, legalNameLocked, countries, industries }: ProfileFormProps) {
  const form = useForm<OrganizationProfileInput>({
    resolver: zodResolver(organizationProfileSchema),
    defaultValues: defaults,
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, reset } = form;
  const [duplicateLegalName, setDuplicateLegalName] = useState(false);
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: FAILURE });

  function onSubmit(values: OrganizationProfileInput) {
    return submit(
      () => updateOrganizationProfile(slug, values),
      (result) => {
        setDuplicateLegalName(Boolean(result.duplicateLegalName));
        if (result.saved) {
          reset(values);
          toast({ title: "Company profile saved" });
        } else if (result.message) {
          toastError(FAILURE, result.message);
        }
      },
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
        readOnly={legalNameLocked}
        description={
          legalNameLocked
            ? "It cannot be changed once a payment has been started for the company."
            : "It can be changed until a payment is started for the company."
        }
      />
      <InputField
        control={control}
        name="displayName"
        id={ids.displayName}
        label="Display name (optional)"
        description="The name candidates see on your vacancies. Defaults to the legal name."
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
      <InputField control={control} name="website" id={ids.website} label="Website (optional)" type="url" autoComplete="url" />
      {duplicateLegalName ? (
        <Notice tone="info" role="status">
          An organisation with a similar name already exists on CHARA.
        </Notice>
      ) : null}
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving..." : "Save profile"}
      </FormButton>
    </form>
  );
}
