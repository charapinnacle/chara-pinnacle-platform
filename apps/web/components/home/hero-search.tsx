import { MapPin, Search } from "lucide-react";
import { FormButton } from "@/components/forms/form-button";
import { Input } from "@/components/ui/input";

const fields = [
  { name: "q", id: "hero-keyword", label: "Keyword", placeholder: "Job title or skill", icon: Search },
  { name: "city", id: "hero-city", label: "City", placeholder: "City", icon: MapPin },
] as const;

// A plain GET form to Find Jobs: it works without JavaScript and loads none, and Find Jobs validates the address it
// receives as it does every other (the 100 characters below are its limit too). One bar: the two fields and the button
// share one border; the labels are for assistive technology, the placeholders say it to everyone else.
export function HeroSearch({ lang }: { lang: string }) {
  return (
    <form
      action={`/${lang}/jobs`}
      method="get"
      role="search"
      aria-label="Search jobs"
      className="grid gap-2 rounded-2xl border border-input bg-card p-2 shadow-card sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
    >
      {fields.map(({ name, id, label, placeholder, icon: Icon }) => (
        <div key={name} className="relative sm:first:border-e sm:first:border-input">
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
          <Icon aria-hidden className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={id}
            name={name}
            maxLength={100}
            autoComplete="off"
            placeholder={placeholder}
            className="h-12 rounded-lg border-transparent bg-transparent ps-10 text-base shadow-none hover:border-transparent focus-visible:ring-0 md:text-base"
          />
        </div>
      ))}
      <FormButton type="submit" className="sm:w-auto sm:px-8">
        Search jobs
      </FormButton>
    </form>
  );
}
