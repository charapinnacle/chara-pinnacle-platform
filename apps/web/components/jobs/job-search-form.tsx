"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { TextLink } from "@/components/forms/text-link";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import {
  formDefaults,
  formFilters,
  searchFormSchema,
  searchPath,
  type SearchFormInput,
} from "@/lib/jobs/search-params";
import { toOptions } from "@/lib/reference-options";
import { employmentTypeOptions, recruitmentPreferenceLabels, salaryPeriodOptions } from "@/lib/validation/job";

type JobSearchFormProps = {
  lang: string;
  query: string;
  occupations: OccupationItem[];
  industries: ReferenceItem[];
  countries: ReferenceItem[];
  currencies: ReferenceItem[];
};

const recruitmentOptions = [
  { value: "local", label: recruitmentPreferenceLabels.local },
  { value: "international", label: recruitmentPreferenceLabels.international },
];

// The address is the state of the search: the form only edits it. Submitting writes the filters to the address, which
// shows the first page of the new search; going back to an earlier address puts its filters back into the form.
export function JobSearchForm({ lang, query, occupations, industries, countries, currencies }: JobSearchFormProps) {
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  const form = useForm<SearchFormInput>({
    resolver: zodResolver(searchFormSchema),
    defaultValues: formDefaults(query),
  });
  const { control, handleSubmit, reset } = form;

  useEffect(() => {
    reset(formDefaults(query));
  }, [query, reset]);

  function search(values: SearchFormInput) {
    startSearch(() => router.push(searchPath(lang, formFilters(searchFormSchema.parse(values)))));
  }

  return (
    <form noValidate role="search" aria-label="Search vacancies" className="grid gap-6" onSubmit={handleSubmit(search)}>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <InputField control={control} name="q" id="search-q" label="Keyword" autoComplete="off" />
        <ComboboxField
          control={control}
          name="country"
          id="search-country"
          label="Country"
          placeholder="Any country"
          options={toOptions(countries)}
        />
        <InputField control={control} name="city" id="search-city" label="City" autoComplete="off" />
        <ComboboxField
          control={control}
          name="occupation"
          id="search-occupation"
          label="Occupation"
          placeholder="Any occupation"
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
          id="search-industry"
          label="Industry"
          placeholder="Any industry"
          options={toOptions(industries)}
        />
        <SelectField
          control={control}
          name="employment_type"
          id="search-employment-type"
          label="Employment type"
          placeholder="Any employment type"
          options={employmentTypeOptions}
        />
        <SelectField
          control={control}
          name="recruitment"
          id="search-recruitment"
          label="Recruitment"
          placeholder="Local and international"
          options={recruitmentOptions}
        />
      </div>

      <fieldset className="grid gap-6 sm:grid-cols-3">
        <legend className="mb-4 text-h2">Minimum salary</legend>
        <InputField control={control} name="salary_min" id="search-salary-min" label="Salary at least" inputMode="decimal" />
        <ComboboxField
          control={control}
          name="salary_currency"
          id="search-salary-currency"
          label="Currency"
          placeholder="Choose a currency"
          options={currencies.map(({ code, name }) => ({ value: code, label: `${code} · ${name}` }))}
        />
        <SelectField
          control={control}
          name="salary_period"
          id="search-salary-period"
          label="Pay period"
          placeholder="Choose a pay period"
          options={salaryPeriodOptions}
        />
      </fieldset>

      <div className="grid gap-1 sm:grid-cols-2">
        <CheckboxField control={control} name="accommodation" id="search-accommodation">
          Accommodation provided
        </CheckboxField>
        <CheckboxField control={control} name="visa_support" id="search-visa-support">
          Visa support offered
        </CheckboxField>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <FormButton type="submit" busy={searching} className="w-auto">
          {searching ? "Searching..." : "Search vacancies"}
        </FormButton>
        <TextLink standalone href={`/${lang}/jobs`}>
          Clear filters
        </TextLink>
      </div>
    </form>
  );
}
