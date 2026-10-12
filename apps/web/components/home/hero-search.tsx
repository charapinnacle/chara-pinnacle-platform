import { MapPin, Search } from "lucide-react";
import { FormButton } from "@/components/forms/form-button";
import { Input } from "@/components/ui/input";

const fields = [
  { name: "q", id: "hero-what", label: "Job title, skill or occupation", icon: Search },
  { name: "where", id: "hero-where", label: "City or country", icon: MapPin },
] as const;

// A plain GET form to Find Jobs: it works without JavaScript and loads none. Find Jobs validates the address it receives as
// it does every other (100 characters is its limit too) and turns the place into a country or a city filter. The light
// token set is put back inside the bar so that it stands out on the photograph; it is 64 px high from md.
export function HeroSearch({ lang }: { lang: string }) {
  return (
    <form
      action={`/${lang}/jobs`}
      method="get"
      role="search"
      aria-label="Search jobs"
      className="light grid gap-1 rounded-2xl bg-card p-2 text-foreground shadow-[0_32px_64px_-24px_rgb(0_0_0/0.7)] md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_auto] md:items-center"
    >
      {fields.map(({ name, id, label, icon: Icon }) => (
        <div key={name} className="relative md:first:border-e md:first:border-border">
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
            className="h-12 rounded-xl border-transparent bg-transparent ps-12 text-base shadow-none hover:border-transparent focus-visible:ring-0 md:text-base dark:bg-transparent"
          />
        </div>
      ))}
      <FormButton type="submit" className="min-h-12 rounded-xl text-base md:w-auto md:px-8">
        Search jobs
      </FormButton>
    </form>
  );
}
