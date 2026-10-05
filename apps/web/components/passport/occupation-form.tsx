"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { saveOccupation } from "@/lib/actions/passport";
import type { OccupationItem } from "@/lib/dal/reference";
import { occupationFormSchema } from "@/lib/validation/passport";

type OccupationFormProps = { occupationId: string | null; occupations: OccupationItem[] };

export function OccupationForm({ occupationId, occupations }: OccupationFormProps) {
  const { form, onSubmit } = usePassportForm(occupationFormSchema, { occupation: occupationId ?? "" }, saveOccupation, {
    failureTitle: "Could not save your occupation",
    saved: "Your occupation was saved",
  });

  return (
    <form noValidate className="grid gap-5" onSubmit={onSubmit}>
      <ComboboxField
        control={form.control}
        name="occupation"
        label="Occupation"
        description="Search the ISCO-08 list by name, for example electrician. Only occupations from the list can be saved."
        placeholder="Search for an occupation"
        emptyText="No matching occupation"
        options={occupations.map(({ code, label, synonyms }) => ({
          value: code,
          label: `${code} · ${label}`,
          keywords: synonyms.join(" "),
        }))}
      />
      <FormButton type="submit" busy={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Saving..." : "Save occupation"}
      </FormButton>
    </form>
  );
}
