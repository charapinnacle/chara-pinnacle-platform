"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Suspense } from "react";
import { useForm, useWatch } from "react-hook-form";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { toast, toastError } from "@/components/feedback/toast-store";
import { ChipsField } from "@/components/forms/chips-field";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { ListingRemovalNotice } from "@/components/organization/listing-removal-notice";
import { saveOrganizationGeographies } from "@/lib/actions/geographies";
import { usageText, type PlanAllowance, type UsagePrompt } from "@/lib/billing/limits";
import type { ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import {
  countryNoun,
  geographiesSchema,
  servedQuestion,
  type GeographiesInput,
} from "@/lib/validation/geographies";
import type { PartnerType } from "@/lib/validation/sign-up";

type WhereYouServeFormProps = {
  slug: string;
  organizationId: string;
  partnerType: PartnerType;
  basedIn: string;
  countries: ReferenceItem[];
  defaults: GeographiesInput;
  // The served-countries limit when it applies.
  marketsPrompt: UsagePrompt | null;
  // The served-countries limit of the plan while limits are not enforced: more may be saved, with a warning.
  marketsAllowance: PlanAllowance | null;
  billingHref: string;
  // Onboarding continues with the next step; the workforce profile page stays and confirms the save.
  onboarding: boolean;
  // The availability listings per source country (FR-K3), on the workforce profile page only.
  listingCounts?: Promise<Readonly<Record<string, number>>>;
};

const FAILURE_TITLE = "Could not save your countries";

// Where you serve (FR-K1): the country the company is based in comes from the Company step and is only shown; the
// source and served countries are chosen from the code list. A failed save keeps the chosen countries.
export function WhereYouServeForm({
  slug,
  organizationId,
  partnerType,
  basedIn,
  countries,
  defaults,
  marketsPrompt,
  marketsAllowance,
  billingHref,
  onboarding,
  listingCounts,
}: WhereYouServeFormProps) {
  const router = useRouter();
  const form = useForm<GeographiesInput>({
    resolver: zodResolver(geographiesSchema(partnerType)),
    defaultValues: defaults,
  });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE_TITLE });
  const sourcesFrom = useWatch({ control, name: "sourcesFrom" });
  const servesMarket = useWatch({ control, name: "servesMarket" });
  const exceeded = marketsAllowance !== null && servesMarket.length > marketsAllowance.limit ? marketsAllowance : null;
  const countryList = {
    options: toOptions(countries),
    placeholder: "Type a country",
    emptyText: "No matching country",
    noneChosen: "No countries chosen yet.",
    noun: countryNoun,
  };

  function onSubmit() {
    return submit(
      () => saveOrganizationGeographies(slug, form.getValues(), { onboarding }),
      (result) => {
        if (result.message) toastError(FAILURE_TITLE, result.message);
        if (result.saved) {
          form.reset(form.getValues());
          // A removed code took its availability listings with it: the counts and the listings are read again.
          if (listingCounts) router.refresh();
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
      <ChipsField
        {...countryList}
        control={control}
        name="sourcesFrom"
        id="geo-sources-from"
        label="Where do you source workers from?"
        description="The countries your workers come from."
        limit={null}
      />
      <ChipsField
        {...countryList}
        control={control}
        name="servesMarket"
        id="geo-serves-market"
        label={servedQuestion[partnerType]}
        description={
          partnerType === "staffing_company"
            ? "The countries where you supply workers to employers."
            : "The countries where you place workers with employers."
        }
        limit={marketsPrompt?.limit ?? null}
        limitNotice={
          marketsPrompt === null ? null : (
            <UpgradePrompt
              organizationId={organizationId}
              organizationType={partnerType}
              prompt={{ ...marketsPrompt, used: marketsPrompt.limit }}
              billingHref={billingHref}
              canUpgrade
            />
          )
        }
      />
      {exceeded ? (
        <Notice tone="warning" role="status">
          <p className="font-medium">
            {usageText("markets", partnerType, servesMarket.length, exceeded.limit)} on your{" "}
            {exceeded.planName ? `${exceeded.planName} plan` : "plan"}.
          </p>
          <p>
            Plan limits are not enforced yet, so you can save these countries. Once they are, you cannot add a country until
            you are within your plan. <TextLink href={billingHref}>Compare plans</TextLink>
          </p>
        </Notice>
      ) : null}
      {listingCounts ? (
        <Suspense fallback={null}>
          <ListingRemovalNotice
            counts={listingCounts}
            saved={formState.defaultValues?.sourcesFrom?.filter((code) => code !== undefined) ?? []}
            current={sourcesFrom}
            nameOf={(code) => countries.find((country) => country.code === code)?.name ?? code}
          />
        </Suspense>
      ) : null}
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving..." : onboarding ? "Continue" : "Save countries"}
      </FormButton>
    </form>
  );
}
