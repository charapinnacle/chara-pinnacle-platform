"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { CountryChipsField } from "@/components/forms/country-chips-field";
import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { saveOrganizationGeographies } from "@/lib/actions/geographies";
import type { ReferenceItem } from "@/lib/dal/reference";
import {
  geographiesSchema,
  marketsLimitMessage,
  servedQuestion,
  type GeographiesInput,
} from "@/lib/validation/geographies";
import type { PartnerType } from "@/lib/validation/sign-up";

type WhereYouServeFormProps = {
  slug: string;
  partnerType: PartnerType;
  basedIn: string;
  countries: ReferenceItem[];
  defaults: GeographiesInput;
  marketsLimit: number | null;
  billingHref: string;
  // Onboarding continues with the next step; the workforce profile page stays and confirms the save.
  onboarding: boolean;
};

const FAILURE_TITLE = "Could not save your countries";

// Where you serve (FR-K1): the country the company is based in comes from the Company step and is only shown; the
// source and served countries are chosen from the code list. A failed save keeps the chosen countries.
export function WhereYouServeForm({
  slug,
  partnerType,
  basedIn,
  countries,
  defaults,
  marketsLimit,
  billingHref,
  onboarding,
}: WhereYouServeFormProps) {
  const form = useForm<GeographiesInput>({
    resolver: zodResolver(geographiesSchema(partnerType)),
    defaultValues: defaults,
  });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE_TITLE });

  function onSubmit() {
    return submit(
      () => saveOrganizationGeographies(slug, form.getValues(), { onboarding }),
      (result) => {
        if (result.message) toastError(FAILURE_TITLE, result.message);
        if (result.saved) {
          form.reset(form.getValues());
          toast({ title: "Countries saved" });
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-8" onSubmit={handleSubmit(onSubmit)}>
      <dl className="grid gap-1">
        <dt className="text-small font-semibold">Where are you based?</dt>
        <dd className="text-body">{basedIn}</dd>
        <dd className="text-small text-muted-foreground">From your company details.</dd>
      </dl>
      <CountryChipsField
        control={control}
        name="sourcesFrom"
        id="geo-sources-from"
        label="Where do you source workers from?"
        description="The countries your workers come from."
        countries={countries}
        limit={null}
      />
      <CountryChipsField
        control={control}
        name="servesMarket"
        id="geo-serves-market"
        label={servedQuestion[partnerType]}
        description={
          partnerType === "staffing_company"
            ? "The countries where you supply workers to employers."
            : "The countries where you place workers with employers."
        }
        countries={countries}
        limit={marketsLimit}
        limitNotice={
          marketsLimit === null ? null : (
            <p className="text-small">
              {marketsLimitMessage(marketsLimit)} <TextLink href={billingHref}>Upgrade to add more.</TextLink>
            </p>
          )
        }
      />
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving..." : onboarding ? "Continue" : "Save countries"}
      </FormButton>
    </form>
  );
}
