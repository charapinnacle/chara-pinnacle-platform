"use client";

import { useWatch } from "react-hook-form";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { saveExperience } from "@/lib/actions/passport";
import {
  availabilityOptions,
  experienceFormSchema,
  todayUtc,
  type ExperienceInput,
} from "@/lib/validation/passport";

export function ExperienceForm({ initial }: { initial: ExperienceInput }) {
  const today = todayUtc();
  const { form, onSubmit } = usePassportForm(experienceFormSchema(today), initial, saveExperience, {
    failureTitle: "Could not save your experience",
    saved: "Your experience and availability were saved",
  });
  const { control, formState } = form;
  const availability = useWatch({ control, name: "availability" });

  return (
    <form noValidate className="grid gap-5" onSubmit={onSubmit}>
      <InputField control={control} name="yearsExperience" label="Years of experience" inputMode="numeric" />
      <SelectField
        control={control}
        name="availability"
        label="Availability"
        placeholder="Not set"
        options={availabilityOptions}
      />
      {availability === "from_date" ? (
        <InputField control={control} name="availableFrom" label="Available from" type="date" />
      ) : null}
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving..." : "Save experience and availability"}
      </FormButton>
    </form>
  );
}
