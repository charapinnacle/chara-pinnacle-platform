"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { SelectField } from "@/components/forms/select-field";
import { ListRow } from "@/components/passport/list-row";
import { usePassportForm } from "@/components/passport/use-passport-form";
import {
  addPreferredEmploymentType,
  addPreferredIndustry,
  removePreferredEmploymentType,
  removePreferredIndustry,
} from "@/lib/actions/passport";
import type { Passport } from "@/lib/dal/passport";
import type { ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import { employmentTypeLabels } from "@/lib/validation/job";
import {
  employmentTypeOptions,
  preferredEmploymentTypeFormSchema,
  preferredIndustrySchema,
} from "@/lib/validation/passport-extensions";

type PreferredIndustriesSectionProps = { selected: string[]; industries: ReferenceItem[]; max: number };

export function PreferredIndustriesSection({ selected, industries, max }: PreferredIndustriesSectionProps) {
  const { form, onSubmit } = usePassportForm(preferredIndustrySchema, { industry: "" }, addPreferredIndustry, {
    failureTitle: "Could not add the industry",
    saved: "Industry added",
    resetOnSuccess: true,
  });
  const nameOf = (code: string) => industries.find((industry) => industry.code === code)?.name ?? code;

  return (
    <div className="grid gap-5">
      {selected.length === 0 ? (
        <p className="text-body text-muted-foreground">No preferred industries yet</p>
      ) : (
        <ul className="grid gap-2" aria-label="Preferred industries">
          {selected.map((code) => (
            <ListRow key={code} name={nameOf(code)} removed="Industry removed" remove={() => removePreferredIndustry(code)}>
              {nameOf(code)}
            </ListRow>
          ))}
        </ul>
      )}
      <form noValidate className="grid gap-4" onSubmit={onSubmit}>
        <ComboboxField
          control={form.control}
          name="industry"
          label="Preferred industry"
          description={`Add the industries you would like to work in, one at a time, up to ${max}.`}
          placeholder="Choose an industry"
          options={toOptions(industries.filter(({ code }) => !selected.includes(code)))}
        />
        <FormButton type="submit" variant="secondary" busy={form.formState.isSubmitting}>
          Add industry
        </FormButton>
      </form>
    </div>
  );
}

type PreferredEmploymentTypesSectionProps = { selected: Passport["preferredEmploymentTypes"] };

export function PreferredEmploymentTypesSection({ selected }: PreferredEmploymentTypesSectionProps) {
  const { form, onSubmit } = usePassportForm(
    preferredEmploymentTypeFormSchema,
    { employmentType: "" },
    addPreferredEmploymentType,
    { failureTitle: "Could not add the employment type", saved: "Employment type added", resetOnSuccess: true },
  );

  return (
    <div className="grid gap-5">
      {selected.length === 0 ? (
        <p className="text-body text-muted-foreground">No preferred employment types yet</p>
      ) : (
        <ul className="grid gap-2" aria-label="Preferred employment types">
          {selected.map((type) => (
            <ListRow
              key={type}
              name={employmentTypeLabels[type]}
              removed="Employment type removed"
              remove={() => removePreferredEmploymentType(type)}
            >
              {employmentTypeLabels[type]}
            </ListRow>
          ))}
        </ul>
      )}
      <form noValidate className="grid gap-4" onSubmit={onSubmit}>
        <SelectField
          control={form.control}
          name="employmentType"
          label="Preferred employment type"
          placeholder="Choose an employment type"
          options={employmentTypeOptions.filter(({ value }) => !selected.includes(value))}
        />
        <FormButton type="submit" variant="secondary" busy={form.formState.isSubmitting}>
          Add employment type
        </FormButton>
      </form>
    </div>
  );
}
