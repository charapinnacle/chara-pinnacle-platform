"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldErrors, type FieldPath } from "react-hook-form";
import { toastError } from "@/components/feedback/toast-store";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import { LegalLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { createJob, reportInvalidJobForm } from "@/lib/actions/jobs";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import {
  employmentTypeOptions,
  jobFormSchema,
  recruitmentPreferenceOptions,
  salaryPeriodOptions,
  type JobFormInput,
  type JobFormValues,
} from "@/lib/validation/job";

type JobFormProps = {
  slug: string;
  occupations: OccupationItem[];
  industries: ReferenceItem[];
  countries: ReferenceItem[];
  currencies: ReferenceItem[];
};

const ids = {
  title: "job-title",
  description: "job-description",
  occupation: "job-occupation",
  industry: "job-industry",
  country: "job-country",
  city: "job-city",
  employmentType: "job-employment-type",
  salaryMin: "job-salary-min",
  salaryMax: "job-salary-max",
  salaryCurrency: "job-salary-currency",
  salaryPeriod: "job-salary-period",
  accommodation: "job-accommodation",
  visaSupport: "job-visa-support",
  recruitmentPreference: "job-recruitment-preference",
} as const satisfies Record<keyof JobFormInput, string>;

const defaultValues: JobFormInput = {
  title: "",
  description: "",
  occupation: "",
  industry: "",
  country: "",
  city: "",
  employmentType: "",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "",
  salaryPeriod: "",
  accommodation: false,
  visaSupport: false,
  recruitmentPreference: "",
};

export function JobForm({ slug, occupations, industries, countries, currencies }: JobFormProps) {
  const form = useForm<JobFormInput, unknown, JobFormValues>({
    resolver: zodResolver(jobFormSchema),
    defaultValues,
  });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: "Could not save the vacancy" });

  function onValid() {
    return submit(
      () => createJob(slug, form.getValues()),
      (result) => {
        if (result.message) {
          toastError("Could not save the vacancy", result.message);
        }
        const [first] = Object.keys(result.errors ?? {});
        if (first) form.setFocus(first as FieldPath<JobFormInput>);
      },
    );
  }

  function onInvalid(errors: FieldErrors<JobFormInput>) {
    // The refusal is only counted for the validation error rate; it must never get in the way of the person typing.
    reportInvalidJobForm(slug, Object.keys(errors)).catch(() => undefined);
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onValid, onInvalid)}>
      <FormErrorSummary form={form} ids={ids} />
      <Notice tone="info">
        Vacancies must follow the{" "}
        <LegalLink slug="platform-rules" newTabLabel="(opens in a new tab)">
          Platform Rules
        </LegalLink>
        .
      </Notice>

      <InputField control={control} name="title" id={ids.title} label="Title" />
      <TextareaField
        control={control}
        name="description"
        id={ids.description}
        label="Description"
        description="50 to 10,000 characters. Plain text; line breaks are kept."
      />
      <ComboboxField
        control={control}
        name="occupation"
        id={ids.occupation}
        label="Occupation"
        description="Search the ISCO-08 list by name, for example welder. Only occupations from the list can be saved."
        placeholder="Search for an occupation"
        emptyText="No matching occupation"
        options={occupations.map(({ code, label, synonyms }) => ({
          value: code,
          label: `${code} · ${label}`,
          keywords: synonyms.join(" "),
        }))}
      />
      <ComboboxField
        control={control}
        name="industry"
        id={ids.industry}
        label="Industry"
        placeholder="Choose an industry"
        options={toOptions(industries)}
      />
      <ComboboxField
        control={control}
        name="country"
        id={ids.country}
        label="Country"
        placeholder="Choose a country"
        options={toOptions(countries)}
      />
      <InputField control={control} name="city" id={ids.city} label="City" autoComplete="off" />
      <SelectField
        control={control}
        name="employmentType"
        id={ids.employmentType}
        label="Employment type"
        placeholder="Choose an employment type"
        options={employmentTypeOptions}
      />

      <fieldset className="grid gap-6 sm:grid-cols-2">
        <legend className="mb-4 text-h2">Salary (optional)</legend>
        <InputField control={control} name="salaryMin" id={ids.salaryMin} label="Salary minimum" inputMode="decimal" />
        <InputField control={control} name="salaryMax" id={ids.salaryMax} label="Salary maximum" inputMode="decimal" />
        <ComboboxField
          control={control}
          name="salaryCurrency"
          id={ids.salaryCurrency}
          label="Currency"
          placeholder="Choose a currency"
          options={currencies.map(({ code, name }) => ({ value: code, label: `${code} · ${name}` }))}
        />
        <SelectField
          control={control}
          name="salaryPeriod"
          id={ids.salaryPeriod}
          label="Pay period"
          placeholder="Choose a pay period"
          options={salaryPeriodOptions}
        />
      </fieldset>

      <CheckboxField control={control} name="accommodation" id={ids.accommodation}>
        Accommodation provided
      </CheckboxField>
      <CheckboxField control={control} name="visaSupport" id={ids.visaSupport}>
        Visa support offered
      </CheckboxField>
      <SelectField
        control={control}
        name="recruitmentPreference"
        id={ids.recruitmentPreference}
        label="Recruitment preference"
        placeholder="Choose a recruitment preference"
        options={recruitmentPreferenceOptions}
      />

      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving vacancy..." : "Save vacancy"}
      </FormButton>
    </form>
  );
}
