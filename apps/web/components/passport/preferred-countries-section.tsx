"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { RemoveButton } from "@/components/passport/remove-button";
import { addPreferredCountry, removePreferredCountry } from "@/lib/actions/passport";
import type { ReferenceItem } from "@/lib/dal/reference";
import { preferredCountrySchema } from "@/lib/validation/passport";

type PreferredCountriesSectionProps = { selected: string[]; countries: ReferenceItem[] };

export function PreferredCountriesSection({ selected, countries }: PreferredCountriesSectionProps) {
  const { form, onSubmit } = usePassportForm(preferredCountrySchema, { country: "" }, addPreferredCountry, {
    failureTitle: "Could not add the country",
    saved: "Country added",
    resetOnSuccess: true,
  });
  const nameOf = (code: string) => countries.find((country) => country.code === code)?.name ?? code;

  return (
    <div className="grid gap-5">
      {selected.length === 0 ? (
        <p className="text-body text-muted-foreground">You have not added any preferred countries yet</p>
      ) : (
        <ul className="grid gap-2">
          {selected.map((code) => (
            <li key={code} className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-1.5">
              <span className="min-w-0 break-words">{nameOf(code)}</span>
              <RemoveButton name={nameOf(code)} removed="Country removed" remove={() => removePreferredCountry(code)} />
            </li>
          ))}
        </ul>
      )}
      <form noValidate className="grid gap-4" onSubmit={onSubmit}>
        <ComboboxField
          control={form.control}
          name="country"
          label="Preferred countries"
          description="Add the countries where you would like to work, one at a time."
          placeholder="Choose a country"
          options={countries
            .filter(({ code }) => !selected.includes(code))
            .map(({ code, name }) => ({ value: code, label: name }))}
        />
        <FormButton type="submit" variant="secondary" busy={form.formState.isSubmitting}>
          Add country
        </FormButton>
      </form>
    </div>
  );
}
