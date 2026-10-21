"use client";

import { useEffect, useState } from "react";
import { Combobox } from "@/components/forms/combobox";
import { FormButton } from "@/components/forms/form-button";
import type { ComboboxOption } from "@/lib/combobox";

export type HeroSearchProps = {
  lang: string;
  // Titles of open vacancies first, then the occupations; in free-text mode the label of a suggestion is what is sent.
  what: readonly ComboboxOption[];
  countries: readonly ComboboxOption[];
};

// The field cell, not the input, shows focus, as marketplace searches do: the whole cell takes a soft rounded highlight
// and the 2 px focus outline of the site, and the input inside it has no border or outline of its own. The outline of
// the input is set by an unlayered rule of globals.css, which only an important utility overrides.
const fieldClassName =
  "grid rounded-xl px-4 py-2 transition-colors duration-150 hover:bg-muted/70 focus-within:bg-muted/70 focus-within:outline-2 focus-within:outline-ring max-md:not-first:border-t md:not-first:border-s";
const inputClassName =
  "rounded-none border-transparent bg-transparent ps-0 text-base shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none! md:text-base";
// The popup is wider than a narrow field and floats as a rounded card; the highlighted row has a brand bar at its start.
const listClassName = "mt-2 min-w-64 rounded-xl border-border p-1.5 shadow-lg";
const optionClassName =
  "min-h-10 rounded-lg px-3 py-2 hover:bg-muted aria-selected:bg-accent aria-selected:shadow-[inset_3px_0_0_var(--color-brand)]";
const popup = { listClassName, optionClassName, checkChosen: true } as const;
const aria = { "aria-invalid": false, "aria-describedby": undefined } as const;
const ignore = () => {};

// The pause after a keystroke before City asks for suggestions, so that typing a name sends one request, not one a letter.
const CITY_DEBOUNCE_MS = 150;

type CitySuggestions = { country: string; options: ComboboxOption[] };

// A GET form to Find Jobs, which validates the address it receives as it does every other. What suggests vacancy titles
// and occupations as the visitor types, names that start with the text first; Country is chosen from the list; once a
// country is chosen, City suggests its cities from /api/cities as the visitor types, the cities with a vacancy first,
// and still takes any city typed. Without a country City is plain text. Without JavaScript the What and City inputs are
// sent as typed and Country is a native select.
export function HeroSearch({ lang, what, countries }: HeroSearchProps) {
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [suggested, setSuggested] = useState<CitySuggestions | null>(null);

  // An answer is kept with the country it is for, so a list of the previous country is never shown; a request that a
  // newer keystroke or country replaced is aborted, so a late answer cannot overwrite a newer one.
  useEffect(() => {
    if (!country) return;
    const controller = new AbortController();
    const query = city.trim();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/cities?${new URLSearchParams({ country, q: query })}`, { signal: controller.signal });
        if (!response.ok) return;
        const { cities } = (await response.json()) as { cities: string[] };
        setSuggested({ country, options: cities.map((name) => ({ value: name, label: name })) });
      } catch {
        // Aborted or offline: City keeps the last list and still takes the typed text.
      }
    }, CITY_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [country, city]);

  const cities = country && suggested?.country === country ? suggested.options : [];

  // An empty field is left out of the address, so an empty search opens Find Jobs at /en/jobs. The browser reads the form
  // when it is submitted, so the fields are enabled again straight after, for a visitor who comes back with Back.
  function leaveOutEmptyFields(event: React.FormEvent<HTMLFormElement>) {
    const empty = [...event.currentTarget.querySelectorAll<HTMLInputElement>('input[name]:not([type="hidden"])')].filter(
      (field) => field.value === "",
    );
    for (const field of empty) field.disabled = true;
    setTimeout(() => empty.forEach((field) => (field.disabled = false)));
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
          {...popup}
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
          {...popup}
          label="Country"
          placeholder="Any country"
          value={country}
          options={countries}
          emptyText="No country matches"
          freeText={false}
          noScriptSelect
          inputRef={null}
          onChange={setCountry}
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
          {...popup}
          label="City"
          placeholder="Any city"
          value={city}
          options={cities}
          emptyText="No suggestion"
          prefiltered
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
