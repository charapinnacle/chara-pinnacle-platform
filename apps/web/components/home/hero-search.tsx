import { MapPin, Search } from "lucide-react";
import { FormButton } from "@/components/forms/form-button";
import { Input } from "@/components/ui/input";

const fields = [
  { name: "q", id: "hero-what", label: "Job title, skill or occupation", icon: Search },
  { name: "where", id: "hero-where", label: "City or country", icon: MapPin },
] as const;

// A plain GET form to Find Jobs: it works without JavaScript and loads none. Find Jobs validates the address it receives as
// it does every other (100 characters is its limit too) and turns the place into a country or a city filter. The icons
// stand in for the labels, which only assistive technology reads.
export function HeroSearch({ lang }: { lang: string }) {
  return (
    <form
      action={`/${lang}/jobs`}
      method="get"
      role="search"
      aria-label="Search jobs"
      className="grid gap-1 rounded-xl border bg-card p-1.5 shadow-card md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_auto] md:items-center"
    >
      {fields.map(({ name, id, label, icon: Icon }) => (
        <div key={name} className="relative max-md:first:border-b md:first:border-e">
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
          <Icon aria-hidden className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={id}
            name={name}
            maxLength={100}
            autoComplete="off"
            placeholder={label}
            className="h-12 rounded-lg border-transparent bg-transparent ps-12 text-base shadow-none hover:border-transparent focus-visible:ring-0 md:text-base"
          />
        </div>
      ))}
      <FormButton type="submit" className="min-h-12 text-base md:w-auto md:px-8">
        Search jobs
      </FormButton>
    </form>
  );
}
