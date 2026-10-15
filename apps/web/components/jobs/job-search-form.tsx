"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, MapPin, Search, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormField, InputField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { Input } from "@/components/ui/input";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import { formDefaults, formSearchPath, searchFormSchema, type SearchFormInput } from "@/lib/jobs/search-params";
import { toOptions } from "@/lib/reference-options";
import { cn } from "@/lib/utils";
import {
  employmentTypeLabels,
  employmentTypeOptions,
  recruitmentPreferenceLabels,
  salaryPeriodOptions,
} from "@/lib/validation/job";

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

// The filters that search as soon as a value is chosen in their menu.
const MENU_FILTERS = ["occupation", "industry", "employment_type", "recruitment"] as const;

const chipClassName =
  "inline-flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-full border bg-card px-4 text-small font-medium whitespace-nowrap transition-colors select-none hover:border-input group-open:border-foreground [&::-webkit-details-marker]:hidden";
const activeChipClassName = "border-primary bg-primary text-primary-foreground hover:border-primary group-open:border-primary";

// A menu below its chip from 768 px; on a phone a sheet from the foot of the screen over a dimmed page, which a row that
// scrolls sideways cannot clip, tall enough for the list of a combobox to open inside it.
// The fields inside are a size smaller than those of a page form: 40 px high, small text.
const menuClassName =
  "z-40 grid content-start gap-3 border bg-card p-3 text-small shadow-card max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:h-[60dvh] max-md:overflow-y-auto max-md:rounded-t-3xl max-md:p-4 max-md:pb-[max(1rem,env(safe-area-inset-bottom))] md:absolute md:start-0 md:top-full md:mt-2 md:w-64 md:rounded-xl [&_button[data-slot]]:h-10 [&_input:not([type=checkbox])]:h-10 [&_input]:text-small [&_label]:text-small [&_select]:h-10 [&_select]:text-small";
const scrimClassName =
  "max-md:open:before:fixed max-md:open:before:inset-0 max-md:open:before:z-30 max-md:open:before:bg-inverse/30 max-md:open:before:content-['']";

type FilterMenuProps = {
  label: string;
  value: string | null;
  className?: string;
  children: React.ReactNode;
};

// A native disclosure: it opens and closes without JavaScript, and the search button sends what was chosen. With
// JavaScript a choice searches at once (see the watch in JobSearchForm).
function FilterMenu({ label, value, className, children }: FilterMenuProps) {
  return (
    <details className={cn("group shrink-0 md:relative", scrimClassName, className)} data-filter-menu>
      <summary className={cn(chipClassName, value && activeChipClassName)}>
        {value ? (
          <>
            <span className="sr-only">{label}: </span>
            {value}
          </>
        ) : (
          label
        )}
        <ChevronDown aria-hidden className="size-3.5 opacity-60 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className={menuClassName}>{children}</div>
    </details>
  );
}

function NoScriptSubmit() {
  return (
    <noscript>
      <FormButton type="submit" className="w-auto justify-self-start">
        Show vacancies
      </FormButton>
    </noscript>
  );
}

// A field of the search bar: an icon, the label for assistive technology and a borderless input.
function BarField({
  control,
  name,
  label,
  placeholder,
  icon,
}: {
  control: Control<SearchFormInput>;
  name: "q" | "where";
  label: string;
  placeholder: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-4 max-sm:not-first:border-t sm:not-first:border-s">
      {icon}
      <div className="min-w-0 flex-1">
        <FormField control={control} name={name} id={`search-${name}`} label={label} hideLabel>
          {(props) => (
            <Input
              {...props}
              maxLength={100}
              autoComplete="off"
              placeholder={placeholder}
              className="h-12 rounded-none border-transparent bg-transparent px-0 text-base shadow-none hover:border-transparent focus-visible:ring-0 md:text-base"
            />
          )}
        </FormField>
      </div>
    </div>
  );
}

// The address is the state of the search: the form only edits it. Submitting writes the filters to the address, which
// shows the first page of the new search; going back to an earlier address puts its filters back into the form.
export function JobSearchForm({ lang, query, occupations, industries, countries, currencies }: JobSearchFormProps) {
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  const [moreOpen, setMoreOpen] = useState(false);
  const root = useRef<HTMLFormElement>(null);
  const countryNames = new Map(countries.map(({ code, name }) => [code, name]));
  const form = useForm<SearchFormInput>({
    resolver: zodResolver(searchFormSchema),
    defaultValues: formDefaults(query, countryNames),
  });
  const { control, handleSubmit, reset, subscribe } = form;
  const values = useWatch({ control });

  useEffect(() => {
    reset(formDefaults(query, new Map(countries.map(({ code, name }) => [code, name]))));
  }, [query, reset, countries]);

  function closeMenus() {
    root.current?.querySelectorAll<HTMLDetailsElement>("details[data-filter-menu][open]").forEach((menu) => {
      menu.open = false;
    });
  }

  function search(submitted: SearchFormInput) {
    closeMenus();
    setMoreOpen(false);
    startSearch(() => router.push(formSearchPath(lang, searchFormSchema.parse(submitted))));
  }
  const openMore = () => setMoreOpen(true);

  // A choice in a filter menu searches at once; the fields of the bar and of More filters wait for their button.
  useEffect(
    () =>
      subscribe({
        name: MENU_FILTERS,
        formState: { values: true },
        callback: ({ type }) => {
          if (type === "change") void handleSubmit(search, openMore)();
        },
      }),
  );

  // One menu at a time; a press outside or Escape closes it.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const onToggle = (event: Event) => {
      const opened = event.target as HTMLDetailsElement;
      if (!opened.open || !opened.matches("[data-filter-menu]")) return;
      node.querySelectorAll<HTMLDetailsElement>("details[data-filter-menu][open]").forEach((menu) => {
        if (menu !== opened) menu.open = false;
      });
    };
    // A press outside the menus closes them, except on Search jobs: the search closes them itself and keeps More filters
    // open when a field there is refused. The dimmed page of a phone sheet is drawn by its details element, so a press
    // there lands on the element itself.
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest("button[type=submit]")) return;
      if (target.matches("details[data-filter-menu]") || !target.closest("details[data-filter-menu]")) closeMenus();
    };
    const onKey = (event: KeyboardEvent) => {
      // An open list of a combobox takes Escape first and marks it handled.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const open = node.querySelector<HTMLDetailsElement>("details[data-filter-menu][open]");
      if (!open) return;
      open.open = false;
      open.querySelector("summary")?.focus();
    };
    node.addEventListener("toggle", onToggle, true);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const occupationLabel = occupations.find(({ code }) => code === values.occupation)?.label ?? null;
  const industryLabel = industries.find(({ code }) => code === values.industry)?.name ?? null;
  const typeLabel = values.employment_type ? employmentTypeLabels[values.employment_type as keyof typeof employmentTypeLabels] : null;
  const recruitmentLabel = values.recruitment
    ? recruitmentPreferenceLabels[values.recruitment as keyof typeof recruitmentPreferenceLabels]
    : null;
  const moreCount = [values.employer, values.salary_min, values.accommodation, values.visa_support].filter(Boolean).length;

  return (
    <form ref={root} noValidate role="search" aria-label="Search jobs" className="grid gap-3" onSubmit={(event) => void handleSubmit(search, openMore)(event)}>
      <div className="grid items-center rounded-3xl border bg-card p-1.5 shadow-card transition-colors focus-within:border-input sm:grid-cols-[minmax(0,1fr)_auto] sm:rounded-full">
        <div className="grid min-w-0 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <BarField
            control={control}
            name="q"
            label="Keyword"
            placeholder="Job title, skill or occupation"
            icon={<Search aria-hidden className="size-4.5 shrink-0 text-muted-foreground" />}
          />
          <BarField
            control={control}
            name="where"
            label="Where"
            placeholder="City or country"
            icon={<MapPin aria-hidden className="size-4.5 shrink-0 text-muted-foreground" />}
          />
        </div>
        <FormButton type="submit" busy={searching} className="min-h-12 rounded-full text-base max-sm:mt-1 sm:w-auto sm:px-7">
          <Search aria-hidden className="size-4" />
          {searching ? "Searching..." : "Search jobs"}
        </FormButton>
      </div>

      <div
        role="group"
        aria-label="Filters"
        className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
      >
        <FilterMenu label="Occupation" value={occupationLabel}>
          <ComboboxField
            control={control}
            name="occupation"
            id="search-occupation"
            label="Occupation"
            placeholder="Any occupation"
            emptyText="No matching occupation"
            noScriptSelect
            options={occupations.map(({ code, label, synonyms }) => ({
              value: code,
              label: `${code} · ${label}`,
              keywords: synonyms.join(" "),
            }))}
          />
          <NoScriptSubmit />
        </FilterMenu>
        <FilterMenu label="Industry" value={industryLabel}>
          <ComboboxField
            control={control}
            name="industry"
            id="search-industry"
            label="Industry"
            placeholder="Any industry"
            noScriptSelect
            options={toOptions(industries)}
          />
          <NoScriptSubmit />
        </FilterMenu>
        <FilterMenu label="Employment type" value={typeLabel}>
          <SelectField
            control={control}
            name="employment_type"
            id="search-employment-type"
            label="Employment type"
            placeholder="Any employment type"
            options={employmentTypeOptions}
          />
          <NoScriptSubmit />
        </FilterMenu>
        <FilterMenu label="Open to" value={recruitmentLabel}>
          <SelectField
            control={control}
            name="recruitment"
            id="search-recruitment"
            label="Recruitment"
            placeholder="Local and international"
            options={recruitmentOptions}
          />
          <NoScriptSubmit />
        </FilterMenu>

        <details
          open={moreOpen}
          onToggle={(event) => setMoreOpen(event.currentTarget.open)}
          className={cn("group shrink-0 md:relative", scrimClassName)}
          data-filter-menu
        >
          <summary className={cn(chipClassName, moreCount > 0 && activeChipClassName)}>
            <SlidersHorizontal aria-hidden className="size-3.5" />
            More filters
            {moreCount > 0 ? <span className="tabular-nums">· {moreCount}</span> : null}
          </summary>
          <div className={cn(menuClassName, "gap-4 md:w-[min(26rem,calc(100vw-4rem))]")}>
            <InputField
              control={control}
              name="employer"
              id="search-employer"
              label="Employer"
              description="Part of the name of the company, at least 2 characters."
              autoComplete="off"
            />

            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="mb-2 font-semibold">Minimum salary</legend>
              <div className="col-span-2">
                <InputField control={control} name="salary_min" id="search-salary-min" label="Salary at least" inputMode="decimal" />
              </div>
              <ComboboxField
                control={control}
                name="salary_currency"
                id="search-salary-currency"
                label="Currency"
                placeholder="Choose"
                options={currencies.map(({ code, name }) => ({ value: code, label: `${code} · ${name}` }))}
              />
              <SelectField
                control={control}
                name="salary_period"
                id="search-salary-period"
                label="Pay period"
                placeholder="Choose"
                options={salaryPeriodOptions}
              />
            </fieldset>

            <div className="grid sm:grid-cols-2">
              <CheckboxField control={control} name="accommodation" id="search-accommodation">
                Accommodation provided
              </CheckboxField>
              <CheckboxField control={control} name="visa_support" id="search-visa-support">
                Visa support offered
              </CheckboxField>
            </div>

            <FormButton type="submit" busy={searching} className="h-10 w-auto justify-self-start max-md:w-full">
              Show vacancies
            </FormButton>
          </div>
        </details>
      </div>
    </form>
  );
}
