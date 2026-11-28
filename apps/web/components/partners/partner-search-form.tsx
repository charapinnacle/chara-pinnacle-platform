"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { ChipsField } from "@/components/forms/chips-field";
import { Combobox } from "@/components/forms/combobox";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { searchCellClassName, searchInputClassName, searchPopup } from "@/components/home/hero-search";
import type { ComboboxOption } from "@/lib/combobox";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import {
  formFilters,
  partnerDirectoryPath,
  partnerFormDefaults,
  partnerSearchFormSchema,
  type PartnerDirectoryKind,
  type PartnerSearchFormInput,
} from "@/lib/partners/search-params";
import { toOptions } from "@/lib/reference-options";
import { countryNoun } from "@/lib/validation/geographies";
import { recruitmentTypeLabels, sizeBandLabels, sizeBands, staffingTypeLabels, staffingTypes } from "@/lib/validation/workforce-offer";
import { cn } from "@/lib/utils";

type PartnerSearchFormProps = {
  lang: string;
  kind: PartnerDirectoryKind;
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
const staffingTypeOptions = staffingTypes.map((value) => ({ value, label: staffingTypeLabels[value] }));
const sizeBandOptions = sizeBands.map((value) => ({ value, label: sizeBandLabels[value] }));

type CellName = "destination" | "occupation" | "based_in" | "industry" | "language" | "recruitment" | "workforce_size";

// One field of the search card: its label above a borderless choice, as on the home page search. These fields only choose
// from their lists, so they never show an error.
function Cell({
  control,
  name,
  id,
  label,
  placeholder,
  options,
  emptyText = "No match",
  className,
}: {
  control: Control<PartnerSearchFormInput>;
  name: CellName;
  id: string;
  label: string;
  placeholder: string;
  options: readonly ComboboxOption[];
  emptyText?: string;
  className?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className={cn(searchCellClassName, className)}>
          <label htmlFor={id} className="text-caption font-semibold">
            {label}
          </label>
          <Combobox
            id={id}
            name={field.name}
            inputClassName={searchInputClassName}
            {...searchPopup}
            label={label}
            placeholder={placeholder}
            value={String(field.value ?? "")}
            options={options}
            emptyText={emptyText}
            freeText={false}
            noScriptSelect={false}
            inputRef={field.ref}
            onChange={field.onChange}
            onBlur={field.onBlur}
            aria-invalid={false}
            aria-describedby={undefined}
          />
        </div>
      )}
    />
  );
}

// The address is the state of the search (FR-L1 AC8): submitting writes the filters to it and shows the first page; going
// back to an earlier address puts its filters back into the form. Every filter keeps a visible label (AC10). The staffing
// directory (FR-L2) offers staffing types and the workforce size in place of language, recruitment type and source
// countries.
export function PartnerSearchForm({ lang, kind, query, occupations, industries, countries, languages, advancedOpen }: PartnerSearchFormProps) {
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  const [moreOpen, setMoreOpen] = useState(advancedOpen);
  const form = useForm<PartnerSearchFormInput>({
    resolver: zodResolver(partnerSearchFormSchema),
    defaultValues: partnerFormDefaults(query, kind),
  });
  const { control, handleSubmit, reset } = form;
  const countryOptions = toOptions(countries);

  const [openFor, setOpenFor] = useState(query);
  if (openFor !== query) {
    setOpenFor(query);
    setMoreOpen(advancedOpen);
  }

  useEffect(() => {
    reset(partnerFormDefaults(query, kind));
  }, [query, kind, reset]);

  function search(values: PartnerSearchFormInput) {
    startSearch(() => router.push(partnerDirectoryPath(lang, kind, formFilters(partnerSearchFormSchema.parse(values)))));
  }

  return (
    <form
      noValidate
      role="search"
      aria-label={kind === "staffing" ? "Search staffing partners" : "Search recruitment partners"}
      className="grid gap-4"
      onSubmit={handleSubmit(search, () => setMoreOpen(true))}
    >
      <div className="grid rounded-2xl border bg-card p-2 shadow-card">
        <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
          <Cell
            control={control}
            name="destination"
            id="partner-destination"
            label="Destination country"
            placeholder="Any destination"
            emptyText="No matching country"
            options={countryOptions}
          />
          <Cell
            control={control}
            name="occupation"
            id="partner-occupation"
            label="Occupation"
            placeholder="Any occupation"
            emptyText="No matching occupation"
            options={occupations.map(({ code, label, synonyms }) => ({
              value: code,
              label,
              keywords: [code, ...synonyms].join(" "),
            }))}
            className="max-md:border-t md:border-s"
          />
          <FormButton type="submit" busy={searching} className="min-h-14 text-base max-md:mt-1.5 md:w-auto md:px-7">
            {searching ? "Searching..." : "Search partners"}
          </FormButton>
        </div>
        <div
          role="group"
          aria-label="Filters"
          className={cn("mt-2 grid border-t pt-2 sm:grid-cols-2", kind === "staffing" ? "lg:grid-cols-3" : "lg:grid-cols-4")}
        >
          <Cell
            control={control}
            name="based_in"
            id="partner-based-in"
            label="Based in"
            placeholder="Any country"
            emptyText="No matching country"
            options={countryOptions}
          />
          <Cell control={control} name="industry" id="partner-industry" label="Industry" placeholder="Any industry" options={toOptions(industries)} />
          {kind === "staffing" ? (
            <Cell
              control={control}
              name="workforce_size"
              id="partner-workforce-size"
              label="Workforce size"
              placeholder="Any size"
              options={sizeBandOptions}
            />
          ) : (
            <>
              <Cell
                control={control}
                name="language"
                id="partner-language"
                label="Language"
                placeholder="Any language"
                emptyText="No matching language"
                options={toOptions(languages)}
              />
              <Cell
                control={control}
                name="recruitment"
                id="partner-recruitment"
                label="Recruitment type"
                placeholder="Local and international"
                options={recruitmentOptions}
              />
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        {kind === "staffing" ? (
          <Controller
            control={control}
            name="staffing_type"
            render={({ field }) => {
              const selected: string[] = field.value;
              return (
                <fieldset id="partner-staffing-type" className="flex flex-wrap items-center gap-2">
                  <legend className="float-start me-1 text-small font-medium">Staffing type</legend>
                  {staffingTypeOptions.map((option, index) => (
                    <label
                      key={option.value}
                      className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-input bg-card px-4 text-small transition-colors duration-150 hover:border-muted-foreground has-checked:border-primary has-checked:ring-1 has-checked:ring-primary has-checked:ring-inset has-focus-visible:outline-2 has-focus-visible:outline-ring"
                    >
                      <input
                        ref={index === 0 ? field.ref : undefined}
                        type="checkbox"
                        name={field.name}
                        className="size-4 accent-primary outline-none!"
                        checked={selected.includes(option.value)}
                        onChange={(event) =>
                          field.onChange(
                            event.target.checked ? [...selected, option.value] : selected.filter((value) => value !== option.value),
                          )
                        }
                        onBlur={field.onBlur}
                      />
                      {option.label}
                    </label>
                  ))}
                </fieldset>
              );
            }}
          />
        ) : null}
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="partner-more-filters"
          onClick={() => setMoreOpen(!moreOpen)}
          className="ms-auto inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-small font-medium transition-colors duration-150 hover:bg-secondary"
        >
          <SlidersHorizontal aria-hidden className="size-4 text-muted-foreground" />
          More filters
          <ChevronDown aria-hidden className={cn("size-4 text-muted-foreground transition-transform duration-200", moreOpen && "rotate-180")} />
        </button>
      </div>

      <div id="partner-more-filters" hidden={!moreOpen} className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className={cn("grid gap-6", kind === "recruitment" && "lg:grid-cols-2 lg:gap-10")}>
          {kind === "recruitment" ? (
            <ChipsField
              control={control}
              name="sources_from"
              id="partner-sources-from"
              label="Sources workers from"
              description="Several countries at once need a plan with advanced partner search."
              options={countryOptions}
              placeholder="Type a country"
              emptyText="No matching country"
              noneChosen="Any country."
              noun={countryNoun}
              limit={null}
            />
          ) : null}
          <fieldset className="grid content-start gap-3">
            <legend className="text-small font-semibold">Workforce capacity</legend>
            <p className="text-small text-muted-foreground">Needs signing in and a plan with advanced partner search. Only listings confirmed recently count.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField control={control} name="capacity" id="partner-capacity" label="Workers available, at least" inputMode="numeric" />
              <InputField control={control} name="within_days" id="partner-within-days" label="Available within (days)" inputMode="numeric" />
            </div>
          </fieldset>
        </div>
        <FormButton type="submit" variant="secondary" busy={searching} className="mt-5 w-auto md:hidden">
          Show results
        </FormButton>
      </div>
    </form>
  );
}
