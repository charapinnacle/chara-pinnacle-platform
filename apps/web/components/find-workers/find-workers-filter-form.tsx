"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { TextLink } from "@/components/forms/text-link";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import {
  findWorkersFormDefaults,
  findWorkersFormSchema,
  findWorkersQuery,
  formFindWorkersFilters,
  withoutAdvancedFilters,
  type FindWorkersFormInput,
} from "@/lib/find-workers/search-params";
import { toOptions } from "@/lib/reference-options";
import { findWorkersPath } from "@/lib/routes";
import { employmentTypeOptions } from "@/lib/validation/job";
import { cefrOptions } from "@/lib/validation/passport";

type FindWorkersFilterFormProps = {
  lang: string;
  slug: string;
  query: string;
  // The requirement the search was opened from, kept in the address so that cards are saved for it.
  requirementId: string | null;
  advanced: boolean;
  // Where an organisation without the advanced filters sees the plans: its billing page for owners and admins, Pricing else.
  plansHref: string;
  occupations: OccupationItem[];
  industries: ReferenceItem[];
  countries: ReferenceItem[];
  languages: ReferenceItem[];
};

const availabilityOptions = [
  { value: "now", label: "Available now" },
  { value: "by", label: "Available by a date" },
];

const advancedLabels = ["Skills", "Language", "Years of experience, at least", "Preferred industry", "Employment type", "May work in"];

// The address is the state of the search (FR-Q2 AC10): submitting writes the filters to it and shows the first page.
// Keyword, occupation, countries and availability are for every plan that may search; the others need advanced worker
// search and are shown locked otherwise. Every filter has a visible label.
export function FindWorkersFilterForm(props: FindWorkersFilterFormProps) {
  const { lang, slug, query, requirementId, advanced, plansHref, occupations, industries, countries, languages } = props;
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  const form = useForm<FindWorkersFormInput>({
    resolver: zodResolver(findWorkersFormSchema),
    defaultValues: findWorkersFormDefaults(query),
  });
  const { control, handleSubmit, reset } = form;
  const availability = useWatch({ control, name: "availability" });

  useEffect(() => {
    reset(findWorkersFormDefaults(query));
  }, [query, reset]);

  function search(values: FindWorkersFormInput) {
    const parsed = formFindWorkersFilters(findWorkersFormSchema.parse(values));
    const filters = advanced ? parsed : withoutAdvancedFilters(parsed);
    startSearch(() => router.push(findWorkersPath(lang, slug, findWorkersQuery({ ...filters, requirement: requirementId ?? undefined }))));
  }

  const countryOptions = toOptions(countries);

  return (
    <form noValidate role="search" aria-label="Filter workers" className="grid gap-5" onSubmit={handleSubmit(search)}>
      <InputField
        control={control}
        name="q"
        id="find-workers-q"
        label="Search workers"
        type="search"
        maxLength={100}
        placeholder="Welders, truck drivers, electricians, cooks"
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ComboboxField
          control={control}
          name="occupation"
          id="find-workers-occupation"
          label="Occupation"
          placeholder="Any occupation"
          emptyText="No matching occupation"
          options={occupations.map(({ code, label, synonyms }) => ({ value: code, label: `${code} · ${label}`, keywords: synonyms.join(" ") }))}
        />
        <ComboboxField
          control={control}
          name="current_country"
          id="find-workers-current-country"
          label="Lives in"
          placeholder="Any country"
          emptyText="No matching country"
          options={countryOptions}
        />
        <ComboboxField
          control={control}
          name="destination"
          id="find-workers-destination"
          label="Destination country"
          placeholder="Any destination"
          emptyText="No matching country"
          options={countryOptions}
        />
        <SelectField control={control} name="availability" id="find-workers-availability" label="Availability" placeholder="Any time" options={availabilityOptions} />
        {availability === "by" ? (
          <InputField control={control} name="available_by" id="find-workers-available-by" label="Available by" type="date" />
        ) : null}
      </div>
      {advanced ? (
        <fieldset className="grid gap-4">
          <legend className="mb-2 text-body font-medium">More filters</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InputField
              control={control}
              name="skills"
              id="find-workers-skills"
              label="Skills"
              description="Separate skills with commas."
              maxLength={600}
            />
            <SelectField
              control={control}
              name="language"
              id="find-workers-language"
              label="Language"
              placeholder="Any language"
              options={languages.map(({ code, name }) => ({ value: code, label: name }))}
            />
            <SelectField control={control} name="language_level" id="find-workers-language-level" label="Language level, at least" placeholder="Any level" options={cefrOptions} />
            <InputField control={control} name="min_experience" id="find-workers-min-experience" label="Years of experience, at least" inputMode="numeric" />
            <ComboboxField
              control={control}
              name="industry"
              id="find-workers-industry"
              label="Preferred industry"
              placeholder="Any industry"
              options={toOptions(industries)}
            />
            <SelectField control={control} name="employment_type" id="find-workers-employment-type" label="Employment type" placeholder="Any type" options={employmentTypeOptions} />
            <ComboboxField
              control={control}
              name="work_authorization"
              id="find-workers-work-authorization"
              label="May work in"
              placeholder="Any country"
              emptyText="No matching country"
              options={countryOptions}
            />
          </div>
        </fieldset>
      ) : (
        <div className="grid gap-2" role="group" aria-labelledby="find-workers-locked">
          <p id="find-workers-locked" className="text-small font-medium">
            More filters
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-small text-muted-foreground">
            <Lock aria-hidden className="size-4" />
            {advancedLabels.join(", ")}: available on Professional and Enterprise.
            <TextLink href={plansHref}>See plans</TextLink>
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <FormButton type="submit" busy={searching} className="w-auto sm:px-8">
          {searching ? "Searching..." : "Show workers"}
        </FormButton>
      </div>
    </form>
  );
}
