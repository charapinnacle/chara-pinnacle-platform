"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarDays, Clock, MessageSquare, Percent, UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { ChipsField } from "@/components/forms/chips-field";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { saveStandardTerms, saveTrackRecord } from "@/lib/actions/partner-terms";
import type { ReferenceItem } from "@/lib/dal/reference";
import { formatCount } from "@/lib/i18n/format";
import {
  standardTermsSchema,
  TERMS_NOTE_MAX,
  trackRecordSchema,
  type StandardTerms,
  type StandardTermsInput,
  type TrackRecordInput,
} from "@/lib/partners/terms-and-record";
import { toOptions } from "@/lib/reference-options";
import {
  feeModelDescriptions,
  feeModelLabels,
  feeModelsByKind,
  hasAmount,
  hasCurrency,
  type FeeModel,
  type PartnerKind,
} from "@/lib/responses/presentation";
import { countryNoun } from "@/lib/validation/geographies";

const feeIcons = {
  fee_per_hire: UserCheck,
  percent_first_year_salary: Percent,
  hourly_rate: Clock,
  monthly_rate: CalendarDays,
  on_request: MessageSquare,
} as const;

const termsIds = {
  feeModel: "terms-fee-model",
  feeAmount: "terms-fee-amount",
  feeCurrency: "terms-fee-currency",
  guaranteeDays: "terms-guarantee",
  minAssignmentWeeks: "terms-assignment",
  note: "terms-note",
} as const;

const recordIds = {
  placementsLastYear: "record-placements",
  countriesPlaced: "record-countries",
} as const;

type StandardTermsFormProps = {
  slug: string;
  kind: PartnerKind;
  terms: StandardTerms | null;
  currencies: ReferenceItem[];
};

// The standard terms of the workforce profile: the fee a company usually charges, shown on its public profile as a
// starting point. A response to a job order still states the fee for that job order.
export function StandardTermsForm({ slug, kind, terms, currencies }: StandardTermsFormProps) {
  const router = useRouter();
  const schema = useMemo(() => standardTermsSchema(kind), [kind]);
  const form = useForm<StandardTermsInput>({
    resolver: zodResolver(schema),
    defaultValues: {
      feeModel: terms?.feeModel ?? "",
      feeAmount: terms?.feeAmount === null || terms === null ? "" : String(terms.feeAmount),
      feeCurrency: terms?.feeCurrency ?? "",
      guaranteeDays: terms?.guaranteeDays === null || terms === null ? "" : String(terms.guaranteeDays),
      minAssignmentWeeks: terms?.minAssignmentWeeks === null || terms === null ? "" : String(terms.minAssignmentWeeks),
      note: terms?.note ?? "",
    },
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, {
    failureTitle: "Could not save the standard terms",
  });
  const feeModel = useWatch({ control, name: "feeModel" }) as FeeModel | "";
  const placement = feeModel === "fee_per_hire" || feeModel === "percent_first_year_salary";
  const rate = feeModel === "hourly_rate" || feeModel === "monthly_rate";
  const options = feeModelsByKind[kind].map((value) => ({
    value,
    label: feeModelLabels[value],
    description: feeModelDescriptions[value],
    icon: feeIcons[value],
  }));

  function onSubmit() {
    return submit(
      () => saveStandardTerms(slug, form.getValues()),
      (result) => {
        if (result.saved) {
          toast({ title: "Standard terms saved" });
          router.refresh();
        } else if (result.message) {
          toastError("Could not save the standard terms", result.message);
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-5" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={termsIds} />
      <div className="grid min-w-0 gap-5">
        <RadioGroupField control={control} name="feeModel" id={termsIds.feeModel} legend="Usual fee" options={options} />
        {hasAmount(feeModel) ? (
          <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
            <InputField
              control={control}
              name="feeAmount"
              id={termsIds.feeAmount}
              label={feeModel === "percent_first_year_salary" ? "Percentage" : "Amount"}
              inputMode="decimal"
              placeholder={feeModel === "percent_first_year_salary" ? "For example, 12.5" : "For example, 1500"}
            />
            {hasCurrency(feeModel) ? (
              <ComboboxField
                control={control}
                name="feeCurrency"
                id={termsIds.feeCurrency}
                label="Currency"
                placeholder="Choose a currency"
                options={toOptions(currencies)}
                emptyText="No matching currency"
              />
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
          {kind !== "staffing" && !rate ? (
            <InputField
              control={control}
              name="guaranteeDays"
              id={termsIds.guaranteeDays}
              label="Guarantee period (days, optional)"
              description="A free replacement if a hire leaves within it; 0 for none."
              inputMode="numeric"
              placeholder="For example, 90"
            />
          ) : null}
          {kind !== "recruitment" && !placement ? (
            <InputField
              control={control}
              name="minAssignmentWeeks"
              id={termsIds.minAssignmentWeeks}
              label="Shortest assignment (weeks, optional)"
              description="The shortest time you lease workers for."
              inputMode="numeric"
              placeholder="For example, 12"
            />
          ) : null}
        </div>
        <TextareaField
          control={control}
          name="note"
          id={termsIds.note}
          label="What the fee includes (optional)"
          description={`For example "Trade test and visa processing included". Up to ${formatCount(TERMS_NOTE_MAX)} characters.`}
        />
      </div>
      <div>
        <FormButton type="submit" busy={formState.isSubmitting}>
          {formState.isSubmitting ? "Saving..." : "Save standard terms"}
        </FormButton>
      </div>
    </form>
  );
}

type TrackRecordFormProps = {
  slug: string;
  placementsLastYear: number | null;
  countriesPlaced: string[];
  countries: ReferenceItem[];
};

// The track record the company states: placements of the last 12 months and the countries it placed workers in. The
// public profile labels them as stated by the company, apart from the hires counted on the platform.
export function TrackRecordForm({ slug, placementsLastYear, countriesPlaced, countries }: TrackRecordFormProps) {
  const router = useRouter();
  const form = useForm<TrackRecordInput>({
    resolver: zodResolver(trackRecordSchema),
    defaultValues: {
      placementsLastYear: placementsLastYear === null ? "" : String(placementsLastYear),
      countriesPlaced,
    },
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, {
    failureTitle: "Could not save the track record",
  });

  function onSubmit() {
    return submit(
      () => saveTrackRecord(slug, form.getValues()),
      (result) => {
        if (result.saved) {
          toast({ title: "Track record saved" });
          router.refresh();
        } else if (result.message) {
          toastError("Could not save the track record", result.message);
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-5" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={recordIds} />
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 sm:items-start">
        <InputField
          control={control}
          name="placementsLastYear"
          id={recordIds.placementsLastYear}
          label="Workers placed in the last 12 months (optional)"
          inputMode="numeric"
          placeholder="For example, 120"
        />
        <div className="sm:col-span-2">
          <ChipsField
            control={control}
            name="countriesPlaced"
            id={recordIds.countriesPlaced}
            label="Countries you have placed workers in (optional)"
            options={toOptions(countries)}
            placeholder="Type a country"
            emptyText="No matching country"
            noneChosen="No countries chosen yet."
            noun={countryNoun}
            limit={50}
          />
        </div>
      </div>
      <div>
        <FormButton type="submit" busy={formState.isSubmitting}>
          {formState.isSubmitting ? "Saving..." : "Save track record"}
        </FormButton>
      </div>
    </form>
  );
}
