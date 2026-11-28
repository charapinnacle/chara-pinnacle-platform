"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toastError } from "@/components/feedback/toast-store";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { runCharaMatch, type CharaMatchResult } from "@/lib/actions/chara-match";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import { charaMatchFormSchema, type CharaMatchFormInput, type CharaMatchFormValues } from "@/lib/validation/chara-match";
import { recruitmentPreferenceOptions } from "@/lib/validation/job";

type CharaMatchFormProps = {
  slug: string;
  defaultValues: CharaMatchFormInput;
  occupations: OccupationItem[];
  industries: ReferenceItem[];
  countries: ReferenceItem[];
  // The billing page for an owner or admin, who can change the plan; null for a member.
  billingHref: string | null;
};

const FAILURE_TITLE = "Could not find matches";

const ids = {
  destination: "match-destination",
  industry: "match-industry",
  occupation: "match-occupation",
  workers: "match-workers",
  start: "match-start",
  recruitment: "match-recruitment",
} as const;

// What the employer needs (brief section 7): destination, industry, occupation, number of workers, start and recruitment
// type. A run opens its summary at its own address; a plan without CHARA Match or a used-up limit is said under the form
// instead of any result.
export function CharaMatchForm({ slug, defaultValues, occupations, industries, countries, billingHref }: CharaMatchFormProps) {
  const form = useForm<CharaMatchFormInput, unknown, CharaMatchFormValues>({
    resolver: zodResolver(charaMatchFormSchema()),
    defaultValues,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: FAILURE_TITLE });
  const router = useRouter();
  const [refused, setRefused] = useState<CharaMatchResult["refused"]>();

  const occupationOptions = useMemo(
    () => occupations.map(({ code, label, synonyms }) => ({ value: code, label, keywords: [code, ...synonyms].join(" ") })),
    [occupations],
  );
  const countryOptions = useMemo(() => toOptions(countries), [countries]);
  const industryOptions = useMemo(() => toOptions(industries), [industries]);

  function onValid() {
    setRefused(undefined);
    return submit(
      () => runCharaMatch(slug, form.getValues()),
      (result) => {
        if (result.runHref) {
          router.push(result.runHref);
          return;
        }
        if (result.refused) setRefused(result.refused);
        if (result.message) toastError(FAILURE_TITLE, result.message);
      },
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onValid)} aria-label="What you need">
      <FormErrorSummary form={form} ids={ids} summaryRef={summaryRef} />
      <div className="grid gap-6 sm:grid-cols-2">
        <ComboboxField
          control={control}
          name="destination"
          id={ids.destination}
          label="Destination country"
          placeholder="Choose a country"
          options={countryOptions}
        />
        <ComboboxField control={control} name="industry" id={ids.industry} label="Industry" placeholder="Choose an industry" options={industryOptions} />
        <ComboboxField
          control={control}
          name="occupation"
          id={ids.occupation}
          label="Occupation"
          placeholder="Search for an occupation"
          emptyText="No matching occupation"
          options={occupationOptions}
        />
        <InputField control={control} name="workers" id={ids.workers} label="Number of workers" inputMode="numeric" />
        <InputField control={control} name="start" id={ids.start} label="Start date" type="date" />
        <SelectField
          control={control}
          name="recruitment"
          id={ids.recruitment}
          label="Recruitment type"
          placeholder="Choose a recruitment type"
          options={recruitmentPreferenceOptions}
        />
      </div>
      <div>
        <FormButton type="submit" busy={formState.isSubmitting}>
          {formState.isSubmitting ? "Finding matches..." : "Find matches"}
        </FormButton>
      </div>
      {refused === "not_in_plan" ? (
        <Notice tone="info" role="status">
          <p>CHARA Match is part of every paid employer plan.</p>
          <p className="mt-2">
            {billingHref ? <TextLink href={billingHref}>Upgrade your plan</TextLink> : "Ask an owner or admin of your organisation to choose a plan."}
          </p>
        </Notice>
      ) : refused === "rate_limited" ? (
        <Notice tone="warning" role="alert">
          <p className="font-semibold">Too many searches. Please wait a minute and try again.</p>
        </Notice>
      ) : null}
    </form>
  );
}
