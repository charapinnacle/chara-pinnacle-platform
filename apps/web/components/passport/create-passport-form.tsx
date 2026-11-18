"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { createPassport } from "@/lib/actions/passport";
import type { ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import { createPassportSchema, type CreatePassportInput } from "@/lib/validation/passport";

const ids = { firstName: "passport-first-name", lastName: "passport-last-name", country: "passport-country" } as const;

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
      <FormErrorSummary form={form} ids={ids} />
      <InputField control={control} name="firstName" id={ids.firstName} label="First name" autoComplete="given-name" />
      <InputField control={control} name="lastName" id={ids.lastName} label="Last name" autoComplete="family-name" />
      <ComboboxField
        control={control}
        name="country"
        id={ids.country}
        label="Current country"
        placeholder="Choose a country"
        options={toOptions(countries)}
      />
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Creating your passport..." : "Create CHARA Passport"}
      </FormButton>
    </form>
  );
}
