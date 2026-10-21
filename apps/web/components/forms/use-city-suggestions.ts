"use client";

import { useEffect, useState } from "react";
import type { ComboboxOption } from "@/lib/combobox";

// The pause after a keystroke before City asks for suggestions, so that typing a name sends one request, not one a letter.
const CITY_DEBOUNCE_MS = 150;

type CitySuggestions = { country: string; options: ComboboxOption[] };

// The cities of the chosen country for the typed text, from /api/cities: the cities with a vacancy first. Without a
// country there are none, and City is plain text. An answer is kept with the country it is for, so a list of the previous
// country is never shown; a request that a newer keystroke or country replaced is aborted, so a late answer cannot
// overwrite a newer one.
export function useCitySuggestions(country: string, city: string): ComboboxOption[] {
  const [suggested, setSuggested] = useState<CitySuggestions | null>(null);

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

  return country && suggested?.country === country ? suggested.options : [];
}
