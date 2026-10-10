import { MapPin, Search } from "lucide-react";
import { FormButton } from "@/components/forms/form-button";
import { controlClassName } from "@/components/forms/control-class";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const fields = [
  { name: "q", id: "hero-keyword", label: "Keyword", placeholder: "Job title or skill", icon: Search },
  { name: "city", id: "hero-city", label: "City", placeholder: "Any city", icon: MapPin },
] as const;

// A plain GET form to Find Jobs: it works without JavaScript and loads none, and Find Jobs validates the address it
// receives as it does every other (the 100 characters below are its limit too).
export function HeroSearch({ lang }: { lang: string }) {
  return (
    <form
      action={`/${lang}/jobs`}
      method="get"
      role="search"
      aria-label="Search vacancies"
      className="grid gap-4 rounded-2xl border bg-card p-card-lg shadow-card sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end sm:gap-3 sm:p-card"
    >
      {fields.map(({ name, id, label, placeholder, icon: Icon }) => (
        <div key={name} className="grid gap-2">
          <label htmlFor={id} className="text-small font-medium">
            {label}
          </label>
          <div className="relative">
            <Icon aria-hidden className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id={id} name={name} maxLength={100} autoComplete="off" placeholder={placeholder} className={cn(controlClassName, "h-11 ps-10")} />
          </div>
        </div>
      ))}
      <FormButton type="submit" className="sm:w-auto sm:px-6">
        Search vacancies
      </FormButton>
    </form>
  );
}
