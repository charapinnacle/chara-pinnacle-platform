import { MapPin, Search } from "lucide-react";
import { FormButton } from "@/components/forms/form-button";
import { Input } from "@/components/ui/input";

const fields = [
  { name: "q", id: "hero-keyword", label: "Keyword", placeholder: "Job title or skill", icon: Search },
  { name: "city", id: "hero-city", label: "City", placeholder: "City", icon: MapPin },
] as const;

// A plain GET form to Find Jobs: it works without JavaScript and loads none, and Find Jobs validates the address it
// receives as it does every other (the 100 characters below are its limit too). One bar: the two fields and the button
// share one white pill, which stands out on the dark hero (the light token set is put back inside it); the labels are for
// assistive technology, the placeholders say it to everyone else.
export function HeroSearch({ lang }: { lang: string }) {
  return (
    <form
      action={`/${lang}/jobs`}
      method="get"
      role="search"
      aria-label="Search jobs"
      className="light grid gap-1 rounded-3xl border border-transparent bg-card p-2 text-foreground shadow-[0_24px_48px_-24px_rgb(0_0_0/0.6)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:rounded-full"
    >
      {fields.map(({ name, id, label, placeholder, icon: Icon }) => (
        <div key={name} className="relative sm:first:border-e sm:first:border-border">
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
          <Icon aria-hidden className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={id}
            name={name}
            maxLength={100}
            autoComplete="off"
            placeholder={placeholder}
            className="h-12 rounded-full border-transparent bg-transparent ps-11 text-base shadow-none hover:border-transparent focus-visible:ring-0 md:text-base dark:bg-transparent"
          />
        </div>
      ))}
      <FormButton type="submit" className="rounded-full sm:w-auto sm:px-8">
        Search jobs
      </FormButton>
    </form>
  );
}
