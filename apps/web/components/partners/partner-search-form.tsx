"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { ChipsField } from "@/components/forms/chips-field";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import {
  formFilters,
  partnerDirectoryPath,
  partnerFormDefaults,
  partnerSearchFormSchema,
  type PartnerSearchFormInput,
} from "@/lib/partners/search-params";
import { toOptions } from "@/lib/reference-options";
import { countryNoun } from "@/lib/validation/geographies";
import { recruitmentTypeLabels } from "@/lib/validation/workforce-offer";

type PartnerSearchFormProps = {
  lang: string;
  query: string;
  occupations: OccupationItem[];
  industries: ReferenceItem[];
  countries: ReferenceItem[];
  languages: ReferenceItem[];
  advancedOpen: boolean;
};

const recruitmentOptions = [
  { value: "local", label: recruitmentTypeLabels.local },
  { value: "international", label: recruitmentTypeLabels.international },
];

// The address is the state of the search (FR-L1 AC8): submitting writes the filters to it and shows the first page; going
// back to an earlier address puts its filters back into the form. Every filter keeps a visible label (AC10).
export function PartnerSearchForm({ lang, query, occupations, industries, countries, languages, advancedOpen }: PartnerSearchFormProps) {
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  const [moreOpen, setMoreOpen] = useState(advancedOpen);
  const form = useForm<PartnerSearchFormInput>({
    resolver: zodResolver(partnerSearchFormSchema),
    defaultValues: partnerFormDefaults(query),
  });
  const { control, handleSubmit, reset } = form;
  const countryOptions = toOptions(countries);

  useEffect(() => {
    reset(partnerFormDefaults(query));
  }, [query, reset]);

  function search(values: PartnerSearchFormInput) {
    startSearch(() => router.push(partnerDirectoryPath(lang, formFilters(partnerSearchFormSchema.parse(values)))));
  }

  return (
    <form
      noValidate
      role="search"
      aria-label="Search recruitment partners"
      className="grid gap-5"
      onSubmit={handleSubmit(search, () => setMoreOpen(true))}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <ComboboxField
          control={control}
          name="destination"
          id="partner-destination"
          label="Destination country"
          placeholder="Any destination"
          emptyText="No matching country"
          options={countryOptions}
        />
        <ComboboxField
          control={control}
          name="occupation"
          id="partner-occupation"
          label="Occupation"
          placeholder="Any occupation"
          emptyText="No matching occupation"
          options={occupations.map(({ code, label, synonyms }) => ({
            value: code,
            label: `${code} · ${label}`,
            keywords: synonyms.join(" "),
          }))}
        />
        <FormButton type="submit" busy={searching} className="md:w-auto md:px-8">
          {searching ? "Searching..." : "Search partners"}
        </FormButton>
      </div>

      <div role="group" aria-label="Filters" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ComboboxField
          control={control}
          name="based_in"
          id="partner-based-in"
          label="Based in"
          placeholder="Any country"
          emptyText="No matching country"
          options={countryOptions}
        />
        <ComboboxField
          control={control}
          name="industry"
          id="partner-industry"
          label="Industry"
          placeholder="Any industry"
          options={toOptions(industries)}
        />
        <ComboboxField
          control={control}
          name="language"
          id="partner-language"
          label="Language"
          placeholder="Any language"
          emptyText="No matching language"
          options={toOptions(languages)}
        />
        <SelectField
          control={control}
          name="recruitment"
          id="partner-recruitment"
          label="Recruitment type"
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
          <div className="lg:max-w-2xl">
            <ChipsField
              control={control}
              name="sources_from"
              id="partner-sources-from"
              label="Sources workers from"
              description="Several countries at once need an employer plan with advanced partner search."
              options={countryOptions}
              placeholder="Type a country"
              emptyText="No matching country"
              noneChosen="Any country."
              noun={countryNoun}
              limit={null}
            />
          </div>
          <fieldset className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
            <legend className="mb-1 text-h3">Workforce capacity</legend>
            <p className="text-small text-muted-foreground sm:col-span-2">
              Needs an employer plan with advanced partner search. Only listings confirmed recently count.
            </p>
            <InputField control={control} name="capacity" id="partner-capacity" label="Workers available, at least" inputMode="numeric" />
            <InputField control={control} name="within_days" id="partner-within-days" label="Available within (days)" inputMode="numeric" />
          </fieldset>
          <FormButton type="submit" variant="secondary" busy={searching} className="w-auto self-start md:hidden">
            Show results
          </FormButton>
        </div>
      </details>
    </form>
  );
}
