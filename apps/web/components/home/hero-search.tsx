"use client";

import { useMemo, useState } from "react";
import { Combobox } from "@/components/forms/combobox";
import { FormButton } from "@/components/forms/form-button";
import type { ComboboxOption } from "@/lib/combobox";

export type HeroSearchProps = {
  lang: string;
  // Titles of open vacancies first, then the occupations; in free-text mode the label of a suggestion is what is sent.
  what: readonly ComboboxOption[];
  countries: readonly ComboboxOption[];
  citiesByCountry: Record<string, string[]>;
};

const fieldClassName = "grid px-4 py-2 max-md:not-first:border-t md:not-first:border-s";
const inputClassName =
  "rounded-none border-transparent bg-transparent ps-0 text-base shadow-none hover:border-transparent focus-visible:ring-0 md:text-base";
const aria = { "aria-invalid": false, "aria-describedby": undefined } as const;
const ignore = () => {};

// A GET form to Find Jobs, which validates the address it receives as it does every other. What suggests vacancy titles
// and occupations as the visitor types, names that start with the text first; Country is chosen from the list; City
// suggests the cities that have a vacancy in the chosen country and still takes any city typed. Without JavaScript the
// What and City inputs are sent as typed and Country is a native select.
export function HeroSearch({ lang, what, countries, citiesByCountry }: HeroSearchProps) {
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");

  const cities = useMemo(() => {
    const names = country ? (citiesByCountry[country] ?? []) : Object.values(citiesByCountry).flat();
    return [...new Set(names)].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }));
  }, [country, citiesByCountry]);

  // An empty field is left out of the address, so an empty search opens Find Jobs at /en/jobs. The browser reads the form
  // when it is submitted, so the fields are enabled again straight after, for a visitor who comes back with Back.
  function leaveOutEmptyFields(event: React.FormEvent<HTMLFormElement>) {
    const empty = [...event.currentTarget.querySelectorAll<HTMLInputElement>('input[name]:not([type="hidden"])')].filter(
      (field) => field.value === "",
    );
    for (const field of empty) field.disabled = true;
    setTimeout(() => empty.forEach((field) => (field.disabled = false)));
  }

  function chooseCountry(code: string) {
    setCountry(code);
    if (code && city && !(citiesByCountry[code] ?? []).includes(city)) setCity("");
  }

  return (
    <form
      action={`/${lang}/jobs`}
      method="get"
      role="search"
      aria-label="Search jobs"
      onSubmit={leaveOutEmptyFields}
      className="grid rounded-2xl border bg-card p-2 text-start shadow-card md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center"
    >
      <div className={fieldClassName}>
        <label htmlFor="hero-what" className="text-caption font-semibold">
          What<span className="sr-only">: Job title, skill or occupation</span>
        </label>
        <Combobox
          {...aria}
          id="hero-what"
          name="q"
          inputName="q"
          maxLength={100}
          inputClassName={inputClassName}
          label="What"
          placeholder="Job title, skill or occupation"
          value={q}
          options={what}
          emptyText="No suggestion"
          freeText
          noScriptSelect={false}
          inputRef={null}
          onChange={setQ}
          onBlur={ignore}
        />
      </div>
      <div className={fieldClassName}>
        <label htmlFor="hero-country" className="text-caption font-semibold">
          Country<span className="sr-only">: Any country</span>
        </label>
        <Combobox
          {...aria}
          id="hero-country"
          name="country"
          inputClassName={inputClassName}
          label="Country"
          placeholder="Any country"
          value={country}
          options={countries}
          emptyText="No country matches"
          freeText={false}
          noScriptSelect
          inputRef={null}
          onChange={chooseCountry}
          onBlur={ignore}
        />
        {/* Disabled while empty, so that without JavaScript only the noscript select sends a country. */}
        <input type="hidden" name="country" value={country} disabled={!country} />
      </div>
      <div className={fieldClassName}>
        <label htmlFor="hero-city" className="text-caption font-semibold">
          City<span className="sr-only">: Any city</span>
        </label>
        <Combobox
          {...aria}
          id="hero-city"
          name="city"
          inputName="city"
          maxLength={100}
          inputClassName={inputClassName}
          label="City"
          placeholder="Any city"
          value={city}
          options={cities}
          emptyText="No suggestion"
          freeText
          noScriptSelect={false}
          inputRef={null}
          onChange={setCity}
          onBlur={ignore}
        />
      </div>
      <FormButton type="submit" className="min-h-14 text-base max-md:mt-1.5 md:w-auto md:px-7">
        Search jobs
      </FormButton>
    </form>
  );
}
