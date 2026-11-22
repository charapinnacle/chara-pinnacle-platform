"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import {
  formJobOrderFilters,
  jobOrderFormDefaults,
  jobOrderFormSchema,
  jobOrderQuery,
  type JobOrderFormInput,
} from "@/lib/job-orders/search-params";
import { toOptions } from "@/lib/reference-options";
import { jobOrdersPath } from "@/lib/routes";
import { recruitmentTypeLabels } from "@/lib/validation/workforce-offer";

type JobOrderFilterFormProps = {
  lang: string;
  slug: string;
  query: string;
  occupations: OccupationItem[];
  industries: ReferenceItem[];
  countries: ReferenceItem[];
};

const recruitmentOptions = [
  { value: "local", label: recruitmentTypeLabels.local },
  { value: "international", label: recruitmentTypeLabels.international },
];

// The address is the state of the marketplace (FR-N1 step Filter, AC7): submitting writes the filters to it and shows the
// first page; going back to an earlier address puts its filters back into the form. Every filter has a visible label
// (AC11). The verification filter is Phase 3.
export function JobOrderFilterForm({ lang, slug, query, occupations, industries, countries }: JobOrderFilterFormProps) {
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  const form = useForm<JobOrderFormInput>({
    resolver: zodResolver(jobOrderFormSchema),
    defaultValues: jobOrderFormDefaults(query),
  });
  const { control, handleSubmit, reset } = form;
  const countryOptions = toOptions(countries);

  useEffect(() => {
    reset(jobOrderFormDefaults(query));
  }, [query, reset]);

  function search(values: JobOrderFormInput) {
    startSearch(() => router.push(jobOrdersPath(lang, slug, jobOrderQuery(formJobOrderFilters(jobOrderFormSchema.parse(values))))));
  }

  return (
    <form noValidate role="search" aria-label="Filter job orders" className="grid gap-5" onSubmit={handleSubmit(search)}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ComboboxField
          control={control}
          name="destination"
          id="job-order-destination"
          label="Destination country"
          placeholder="Any destination"
          emptyText="No matching country"
          options={countryOptions}
        />
        <ComboboxField
          control={control}
          name="source"
          id="job-order-source"
          label="Source country"
          placeholder="Any source country"
          emptyText="No matching country"
          options={countryOptions}
        />
        <ComboboxField
          control={control}
          name="occupation"
          id="job-order-occupation"
          label="Occupation"
          placeholder="Any occupation"
          emptyText="No matching occupation"
          options={occupations.map(({ code, label, synonyms }) => ({ value: code, label, keywords: [code, ...synonyms].join(" ") }))}
        />
        <ComboboxField
          control={control}
          name="industry"
          id="job-order-industry"
          label="Industry"
          placeholder="Any industry"
          options={toOptions(industries)}
        />
        <InputField control={control} name="workers_min" id="job-order-workers-min" label="Workers, at least" inputMode="numeric" />
        <InputField control={control} name="workers_max" id="job-order-workers-max" label="Workers, at most" inputMode="numeric" />
        <InputField control={control} name="start_from" id="job-order-start-from" label="Starts on or after" type="date" />
        <InputField control={control} name="start_to" id="job-order-start-to" label="Starts on or before" type="date" />
        <SelectField
          control={control}
          name="recruitment"
          id="job-order-recruitment"
          label="Recruitment type"
          placeholder="Local and international"
          options={recruitmentOptions}
        />
      </div>
      <FormButton type="submit" busy={searching} className="w-auto self-start sm:px-8">
        {searching ? "Filtering..." : "Show job orders"}
      </FormButton>
    </form>
  );
}
