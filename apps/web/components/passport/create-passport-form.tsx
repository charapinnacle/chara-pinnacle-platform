"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { createPassport } from "@/lib/actions/passport";
import type { ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import { createPassportSchema, type CreatePassportInput } from "@/lib/validation/passport";

export function CreatePassportForm({ countries }: { countries: ReferenceItem[] }) {
  const { form, onSubmit } = usePassportForm(
    createPassportSchema,
    { firstName: "", lastName: "", country: "" } satisfies CreatePassportInput,
    async (values) => (await createPassport(values)) ?? {},
    { failureTitle: "Could not create your passport", saved: "Your passport was created" },
  );
  const { control, formState } = form;

  return (
    <form noValidate className="grid gap-6" onSubmit={onSubmit}>
      <InputField control={control} name="firstName" label="First name" autoComplete="given-name" />
      <InputField control={control} name="lastName" label="Last name" autoComplete="family-name" />
      <ComboboxField
        control={control}
        name="country"
        label="Current country"
        placeholder="Choose a country"
        options={toOptions(countries)}
      />
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Creating your passport..." : "Create my passport"}
      </FormButton>
    </form>
  );
}
