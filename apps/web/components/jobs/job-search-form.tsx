"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
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
  const [moreOpen, setMoreOpen] = useState(false);
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
    <form
      noValidate
      role="search"
      aria-label="Search jobs"
      className="grid gap-4"
      onSubmit={handleSubmit(search, () => setMoreOpen(true))}
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start">
        <InputField control={control} name="q" id="search-q" label="Keyword" hideLabel placeholder="Job title or skill" autoComplete="off" />
        <InputField control={control} name="city" id="search-city" label="City" hideLabel placeholder="City" autoComplete="off" />
        <ComboboxField
          control={control}
          name="country"
          id="search-country"
          label="Country"
          hideLabel
          placeholder="Any country"
          options={toOptions(countries)}
          noScriptSelect
        />
        <FormButton type="submit" busy={searching} className="md:w-auto md:px-8">
          {searching ? "Searching..." : "Search jobs"}
        </FormButton>
      </div>

      <div role="group" aria-label="Filters" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ComboboxField
          control={control}
          name="occupation"
          id="search-occupation"
          label="Occupation"
          hideLabel
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
          hideLabel
          placeholder="Any industry"
          options={toOptions(industries)}
        />
        <SelectField
          control={control}
          name="employment_type"
          id="search-employment-type"
          label="Employment type"
          hideLabel
          placeholder="Any employment type"
          options={employmentTypeOptions}
        />
        <SelectField
          control={control}
          name="recruitment"
          id="search-recruitment"
          label="Recruitment"
          hideLabel
          placeholder="Local and international"
          options={recruitmentOptions}
        />
      </div>

      <details open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)} className="group">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 text-body font-medium">
          More filters
          <ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <div className="grid gap-5 pt-3">
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-3 text-h3">Minimum salary</legend>
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

          <FormButton type="submit" variant="secondary" busy={searching} className="w-auto self-start md:hidden">
            Show results
          </FormButton>
        </div>
      </details>
    </form>
  );
}
