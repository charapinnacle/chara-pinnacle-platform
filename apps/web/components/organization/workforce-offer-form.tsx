"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Earth, MapPin, Plane } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { CheckboxGroupField } from "@/components/forms/checkbox-group-field";
import { ChipsField, type ChipOption } from "@/components/forms/chips-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { SelectField } from "@/components/forms/select-field";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { ListingRemovalNotice } from "@/components/organization/listing-removal-notice";
import { saveWorkforceOffer } from "@/lib/actions/workforce-offer";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import type { PartnerType } from "@/lib/validation/sign-up";
import {
  industryNoun,
  languageNoun,
  occupationNoun,
  occupationsLimitMessage,
  recruitmentTypeLabels,
  sizeBandLabels,
  sizeBands,
  staffingTypeLabels,
  staffingTypes,
  workforceOfferSchema,
  type WorkforceOfferInput,
} from "@/lib/validation/workforce-offer";

type WorkforceOfferFormProps = {
  slug: string;
  partnerType: PartnerType;
  occupations: OccupationItem[];
  industries: ReferenceItem[];
  languages: ReferenceItem[];
  defaults: WorkforceOfferInput;
  occupationsLimit: number | null;
  billingHref: string;
  // Onboarding continues with the next step; the workforce profile page stays and confirms the save.
  onboarding: boolean;
  // The availability listings per occupation (FR-K3), on the workforce profile page only.
  listingCounts?: Promise<Readonly<Record<string, number>>>;
};

const FAILURE_TITLE = "Could not save what you offer";

const ids = {
  occupations: "offer-occupations",
  industries: "offer-industries",
  languages: "offer-languages",
  recruitmentType: "offer-recruitment-type",
  staffingService: "offer-staffing-service",
  staffingTypes: "offer-staffing-types",
  sizeBand: "offer-size-band",
  foundedYear: "offer-founded-year",
} as const;

const recruitmentTypeOptions = [
  { value: "local", label: recruitmentTypeLabels.local, icon: MapPin, description: "Workers who already live in the country of the job." },
  { value: "international", label: recruitmentTypeLabels.international, icon: Plane, description: "Workers who move to the country of the job." },
  { value: "both", label: recruitmentTypeLabels.both, icon: Earth, description: "Local and international workers." },
];

const staffingTypeOptions = staffingTypes.map((value) => ({ value, label: staffingTypeLabels[value] }));
const sizeBandOptions = sizeBands.map((value) => ({ value, label: sizeBandLabels[value] }));

// What you offer (FR-K2): occupations from the ISCO-08 list with its synonyms (the list of the CHARA Passport), the
// industries and languages from their code lists, the recruitment type, and the staffing types: required for a staffing
// company, shown to a recruitment company once it ticks that it also supplies staff [d2.4]. A failed save keeps the
// selection.
export function WorkforceOfferForm({
  slug,
  partnerType,
  occupations,
  industries,
  languages,
  defaults,
  occupationsLimit,
  billingHref,
  onboarding,
  listingCounts,
}: WorkforceOfferFormProps) {
  const router = useRouter();
  const form = useForm<WorkforceOfferInput>({
    resolver: zodResolver(workforceOfferSchema(partnerType)),
    defaultValues: defaults,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: FAILURE_TITLE });
  const staffingService = useWatch({ control, name: "staffingService" });
  const chosenOccupations = useWatch({ control, name: "occupations" });
  const showStaffingTypes = partnerType === "staffing_company" || staffingService;
  const occupationOptions: ChipOption[] = occupations.map(({ code, label, synonyms }) => ({
    value: code,
    label: `${code} · ${label}`,
    keywords: synonyms.join(" "),
    chip: label,
  }));

  function onSubmit() {
    return submit(
      () => saveWorkforceOffer(slug, form.getValues(), { onboarding }),
      (result) => {
        if (result.message) toastError(FAILURE_TITLE, result.message);
        if (result.saved) {
          form.reset(form.getValues());
          // A removed code took its availability listings with it: the counts and the listings are read again.
          if (listingCounts) router.refresh();
          toast({ title: "Workforce offer saved" });
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-8" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      <ChipsField
        control={control}
        name="occupations"
        id={ids.occupations}
        label="Which occupations do you recruit or supply?"
        description="Search the ISCO-08 list by name, for example welder. Only occupations from the list can be saved."
        options={occupationOptions}
        placeholder="Type an occupation"
        emptyText="No matching occupation"
        noneChosen="No occupations chosen yet."
        noun={occupationNoun}
        limit={occupationsLimit}
        limitNotice={
          occupationsLimit === null ? null : (
            <p className="text-small">
              {occupationsLimitMessage(occupationsLimit)} <TextLink href={billingHref}>Upgrade to add more.</TextLink>
            </p>
          )
        }
      />
      <ChipsField
        control={control}
        name="industries"
        id={ids.industries}
        label="Which industries do you serve? (optional)"
        options={toOptions(industries)}
        placeholder="Type an industry"
        emptyText="No matching industry"
        noneChosen="No industries chosen yet."
        noun={industryNoun}
        limit={null}
      />
      <ChipsField
        control={control}
        name="languages"
        id={ids.languages}
        label="Which languages do your candidates speak? (optional)"
        options={toOptions(languages)}
        placeholder="Type a language"
        emptyText="No matching language"
        noneChosen="No languages chosen yet."
        noun={languageNoun}
        limit={null}
      />
      <RadioGroupField
        control={control}
        name="recruitmentType"
        id={ids.recruitmentType}
        legend="Recruitment type"
        options={recruitmentTypeOptions}
      />
      {partnerType === "recruitment_company" ? (
        <CheckboxField control={control} name="staffingService" id={ids.staffingService}>
          We also supply staff (staffing)
        </CheckboxField>
      ) : null}
      {showStaffingTypes ? (
        <CheckboxGroupField
          control={control}
          name="staffingTypes"
          id={ids.staffingTypes}
          legend="Staffing types (choose at least one)"
          options={staffingTypeOptions}
        />
      ) : null}
      <SelectField
        control={control}
        name="sizeBand"
        id={ids.sizeBand}
        label="Company size (optional)"
        placeholder="Choose a size"
        options={sizeBandOptions}
      />
      <InputField
        control={control}
        name="foundedYear"
        id={ids.foundedYear}
        label="Year founded (optional)"
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
      />
      {listingCounts ? (
        <Suspense fallback={null}>
          <ListingRemovalNotice
            counts={listingCounts}
            saved={formState.defaultValues?.occupations?.filter((code) => code !== undefined) ?? []}
            current={chosenOccupations}
            nameOf={(code) => occupations.find((occupation) => occupation.code === code)?.label ?? code}
          />
        </Suspense>
      ) : null}
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving..." : onboarding ? "Continue" : "Save what you offer"}
      </FormButton>
    </form>
  );
}
