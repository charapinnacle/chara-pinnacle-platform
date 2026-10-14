import { FormButton } from "@/components/forms/form-button";
import { Input } from "@/components/ui/input";

const fields = [
  { name: "q", id: "hero-what", label: "What", hint: "Job title, skill or occupation" },
  { name: "where", id: "hero-where", label: "Where", hint: "City or country" },
] as const;

// A plain GET form to Find Jobs: it works without JavaScript and loads none. Find Jobs validates the address it receives as
// it does every other (100 characters is its limit too) and turns the place into a country or a city filter. The short
// visible label starts the accessible name and the hint completes it, so a screen reader hears what the placeholder shows.
export function HeroSearch({ lang }: { lang: string }) {
  return (
    <form
      action={`/${lang}/jobs`}
      method="get"
      role="search"
      aria-label="Search jobs"
      className="grid rounded-2xl border bg-card p-2 text-start shadow-card md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center"
    >
      {fields.map(({ name, id, label, hint }) => (
        <div key={name} className="grid px-4 py-2 max-md:not-first:border-t md:not-first:border-s">
          <label htmlFor={id} className="text-caption font-semibold">
            {label}
            <span className="sr-only">: {hint}</span>
          </label>
          <Input
            id={id}
            name={name}
            maxLength={100}
            autoComplete="off"
            placeholder={hint}
            className="h-11 rounded-none border-transparent bg-transparent px-0 md:h-8 text-base shadow-none hover:border-transparent focus-visible:ring-0 md:text-base"
          />
        </div>
      ))}
      <FormButton type="submit" className="min-h-14 text-base max-md:mt-1.5 md:w-auto md:px-7">
        Search jobs
      </FormButton>
    </form>
  );
}
