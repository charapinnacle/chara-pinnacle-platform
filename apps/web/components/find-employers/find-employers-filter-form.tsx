"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { useActionCall } from "@/components/feedback/use-action-call";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { TextLink } from "@/components/forms/text-link";
import { saveEmployerSearch } from "@/lib/actions/find-employers";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import {
  findEmployersFormDefaults,
  findEmployersFormSchema,
  findEmployersQuery,
  formFindEmployersFilters,
  type FindEmployersFormInput,
} from "@/lib/find-employers/search-params";
import { toOptions } from "@/lib/reference-options";
import { findEmployersPath } from "@/lib/routes";

type FindEmployersFilterFormProps = {
  lang: string;
  slug: string;
  query: string;
  advanced: boolean;
  // Where a partner without the advanced filters sees the plans: its billing page for owners and admins, Pricing else.
  plansHref: string;
  occupations: OccupationItem[];
  industries: ReferenceItem[];
  countries: ReferenceItem[];
};

function LockedFilter({ id, label, plansHref }: { id: string; label: string; plansHref: string }) {
  return (
    <div className="grid content-start gap-2" role="group" aria-labelledby={id}>
      <p id={id} className="text-small font-medium">
        {label}
      </p>
      <p className="flex flex-wrap items-center gap-x-2 text-small text-muted-foreground">
        <Lock aria-hidden className="size-4" />
        Available on Professional.
        <TextLink href={plansHref}>See plans</TextLink>
      </p>
    </div>
  );
}

// The address is the state of the search (FR-L3 AC9, AC11): submitting writes the filters to it and shows the first page.
// Destination and industry are for every paid plan; occupation and size, and Save search, need advanced employer
// discovery, and are shown locked otherwise. Every filter has a visible label.
export function FindEmployersFilterForm(props: FindEmployersFilterFormProps) {
  const { lang, slug, query, advanced, plansHref, occupations, industries, countries } = props;
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  const { pending: saving, run } = useActionCall("The search was not saved");
  const form = useForm<FindEmployersFormInput>({
    resolver: zodResolver(findEmployersFormSchema),
    defaultValues: findEmployersFormDefaults(query),
  });
  const { control, handleSubmit, reset } = form;

  useEffect(() => {
    reset(findEmployersFormDefaults(query));
  }, [query, reset]);

  function search(values: FindEmployersFormInput) {
    const filters = formFindEmployersFilters(findEmployersFormSchema.parse(values));
    if (!advanced) {
      filters.occupation = undefined;
      filters.min_workers = undefined;
    }
    startSearch(() => router.push(findEmployersPath(lang, slug, findEmployersQuery(filters))));
  }

  function save(values: FindEmployersFormInput) {
    if (saving) return;
    run(() => saveEmployerSearch(slug, values), "Search saved");
  }

  return (
    <form noValidate role="search" aria-label="Filter employers" className="grid gap-5" onSubmit={handleSubmit(search)}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ComboboxField
          control={control}
          name="destination"
          id="find-employers-destination"
          label="Destination country"
          placeholder="Any destination"
          emptyText="No matching country"
          options={toOptions(countries)}
        />
        <ComboboxField
          control={control}
          name="industry"
          id="find-employers-industry"
          label="Industry"
          placeholder="Any industry"
          options={toOptions(industries)}
        />
        {advanced ? (
          <>
            <ComboboxField
              control={control}
              name="occupation"
              id="find-employers-occupation"
              label="Occupation"
              placeholder="Any occupation"
              emptyText="No matching occupation"
              options={occupations.map(({ code, label, synonyms }) => ({ value: code, label: `${code} · ${label}`, keywords: synonyms.join(" ") }))}
            />
            <InputField
              control={control}
              name="min_workers"
              id="find-employers-min-workers"
              label="Workers needed, at least"
              inputMode="numeric"
            />
          </>
        ) : (
          <>
            <LockedFilter id="find-employers-occupation-locked" label="Occupation" plansHref={plansHref} />
            <LockedFilter id="find-employers-size-locked" label="Workers needed, at least" plansHref={plansHref} />
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <FormButton type="submit" busy={searching} className="w-auto sm:px-8">
          {searching ? "Searching..." : "Show employers"}
        </FormButton>
        {advanced ? (
          <FormButton
            type="button"
            variant="secondary"
            className="w-auto"
            aria-busy={saving || undefined}
            onClick={handleSubmit(save)}
          >
            Save search
          </FormButton>
        ) : null}
      </div>
    </form>
  );
}
