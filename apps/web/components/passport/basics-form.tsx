"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { saveBasics } from "@/lib/actions/passport";
import type { ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import { basicsFormSchema, type BasicsInput } from "@/lib/validation/passport";

type BasicsFormProps = { initial: BasicsInput; countries: ReferenceItem[] };

export function BasicsForm({ initial, countries }: BasicsFormProps) {
  const { form, onSubmit } = usePassportForm(basicsFormSchema, initial, saveBasics, {
    failureTitle: "Could not save your details",
    saved: "Your details were saved",
  });
  const { control, formState } = form;

  return (
    <form noValidate className="grid gap-5" onSubmit={onSubmit}>
      <InputField control={control} name="firstName" label="First name" autoComplete="given-name" />
      <InputField control={control} name="lastName" label="Last name" autoComplete="family-name" />
      <InputField
        control={control}
        name="headline"
        label="Headline"
        description="One line about your work, for example Welder with 6 years of experience. Do not enter ID numbers, date of birth, religion, health or other sensitive details."
      />
      <ComboboxField
        control={control}
        name="country"
        label="Current country"
        placeholder="Choose a country"
        options={toOptions(countries)}
      />
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving..." : "Save details"}
      </FormButton>
    </form>
  );
}
