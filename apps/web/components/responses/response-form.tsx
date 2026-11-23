"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarDays, Clock, MessageSquare, Percent, UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { toast, toastError } from "@/components/feedback/toast-store";
import { CheckboxGroupField } from "@/components/forms/checkbox-group-field";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { ResponseDocuments } from "@/components/responses/response-documents";
import { respondToRequirement, updateMyResponse, type ResponseResult } from "@/lib/actions/responses";
import type { OrganizationType, UsagePrompt } from "@/lib/billing/limits";
import type { ResponseDocument } from "@/lib/dal/responses";
import { characterCount, formatCount } from "@/lib/i18n/format";
import { toOptions } from "@/lib/reference-options";
import {
  feeModelDescriptions,
  feeModelLabels,
  feeModels,
  hasAmount,
  hasCurrency,
  NOT_A_PARTY,
  type FeeModel,
} from "@/lib/responses/presentation";
import { RESPONSE_MESSAGES } from "@/lib/responses/refusal";
import { responsePath } from "@/lib/routes";
import {
  CERTIFICATES_MAX,
  EXPERIENCE_MAX,
  feeInclusionLabels,
  feeInclusions,
  languageLevels,
  NOTES_MAX,
  responseFormSchema,
  TIMELINE_MAX,
  type KeptValues,
  type ResponseFormInput,
  type ResponseFormValues,
} from "@/lib/validation/response";

const ids = {
  capacity: "response-capacity",
  availableFrom: "response-available-from",
  timelineNote: "response-timeline",
  experienceNote: "response-experience",
  feeModel: "response-fee-model",
  feeAmount: "response-fee-amount",
  feeCurrency: "response-fee-currency",
  notes: "response-notes",
  languageCode: "response-language",
  languageLevel: "response-language-level",
  minExperienceYears: "response-min-experience",
  certificates: "response-certificates",
  feeIncludes: "response-fee-includes",
  guaranteeDays: "response-guarantee",
  leadTimeWeeks: "response-lead-time",
} as const;

const levelOptions = languageLevels.map((level) => ({ value: level, label: level }));
const inclusionOptions = feeInclusions.map((value) => ({ value, label: feeInclusionLabels[value] }));

const sendingId = "response-document-sending";

const feeIcons = {
  fee_per_hire: UserCheck,
  percent_first_year_salary: Percent,
  hourly_rate: Clock,
  monthly_rate: CalendarDays,
  on_request: MessageSquare,
} as const;

const feeOptions = feeModels.map((value) => ({
  value,
  label: feeModelLabels[value],
  description: feeModelDescriptions[value],
  icon: feeIcons[value],
}));

type ResponseFormProps = {
  lang: string;
  slug: string;
  requirementId: string;
  // A new response, or the edit of a live one from the version the page was loaded with (a save from an older one is
  // refused as stale).
  edit?: { responseId: string; version: number; values: ResponseFormInput; kept: KeptValues };
  workersNeeded: number;
  maxCapacity: number;
  currencies: { code: string; name: string }[];
  // The languages a partner can name for its workers' level.
  languages: { code: string; name: string }[];
  // The currency of the requirement's salary, offered first for the fee.
  defaultCurrency?: string | null;
  documents: ResponseDocument[];
  documentsMax: number;
  // For the upgrade prompt when the monthly limit is reached on submit.
  organization: { id: string; type: OrganizationType; canManage: boolean };
  billingHref: string;
  // The id of the reason the response cannot be saved now (an outdated commitment): the button is disabled and described
  // by it.
  blockedBy?: string;
};

// The response form (FR-O2 step Write, AC1 to AC5, AC10, AC11; FR-N2 step Respond): the workers offered within the
// employer's tolerance, from when, the timeline, the experience, the fee model with its amount and currency, notes and
// the supporting documents, with the statement that the platform is not a party next to the fee fields and no payment
// field. Errors show at their fields and in the summary, and the focus goes to the first invalid field; a refusal of the
// server keeps what was entered and the files.
export function ResponseForm({
  lang,
  slug,
  requirementId,
  edit,
  workersNeeded,
  maxCapacity,
  currencies,
  languages,
  defaultCurrency,
  documents,
  documentsMax,
  organization,
  billingHref,
  blockedBy,
}: ResponseFormProps) {
  const schema = useMemo(() => responseFormSchema({ maxCapacity, kept: edit?.kept }), [maxCapacity, edit?.kept]);
  const form = useForm<ResponseFormInput, unknown, ResponseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: edit?.values ?? {
      capacity: "",
      availableFrom: "",
      timelineNote: "",
      experienceNote: "",
      feeModel: "",
      feeAmount: "",
      feeCurrency: defaultCurrency ?? "",
      notes: "",
    },
  });
  const { control, formState, handleSubmit } = form;
  const failureTitle = edit ? "Your changes were not saved" : "Your response was not sent";
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle });
  const router = useRouter();
  const [limitReached, setLimitReached] = useState<UsagePrompt | null>(null);
  const [stale, setStale] = useState(false);
  const [pollKey, setPollKey] = useState(0);
  const [sendingFile, setSendingFile] = useState(false);
  // The summary takes the focus after a refusal of the server; after a check of the form the first invalid field does.
  const [refused, setRefused] = useState(false);
  const feeModel = useWatch({ control, name: "feeModel" }) as FeeModel | "";
  const experience = useWatch({ control, name: "experienceNote" });
  const currencyOptions = useMemo(() => toOptions(currencies), [currencies]);
  const languageOptions = useMemo(() => languages.map(({ code, name }) => ({ value: code, label: name })), [languages]);

  function onSubmit(values: ResponseFormValues) {
    if (sendingFile) return;
    setLimitReached(null);
    setStale(false);
    setRefused(false);
    return submit(
      (): Promise<ResponseResult> =>
        edit
          ? updateMyResponse(slug, { responseId: edit.responseId, expectedVersion: edit.version }, values)
          : respondToRequirement(slug, requirementId, values),
      (result) => {
        setRefused(Boolean(result.errors || result.message || result.limitReached));
        if (result.limitReached) {
          setLimitReached(result.limitReached);
          toastError(failureTitle, "Your plan's limit of responses this month is reached.");
          return;
        }
        if (result.message) {
          setStale(result.message === RESPONSE_MESSAGES.stale);
          if (result.message === RESPONSE_MESSAGES.scanning || result.message === RESPONSE_MESSAGES.uploadMissing) setPollKey((key) => key + 1);
          toastError(failureTitle, result.message);
          return;
        }
        if (result.responseId) {
          if (result.termsMessage) toastError(edit ? "Changes saved, terms missing" : "Response sent, terms missing", result.termsMessage);
          else toast({ title: edit ? "Changes saved" : "Response sent" });
          router.push(responsePath(lang, slug, result.responseId));
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onSubmit, () => setRefused(false))}>
      <FormErrorSummary
        form={form}
        ids={ids}
        summaryRef={refused ? summaryRef : undefined}
        action={
          stale ? (
            <FormButton type="button" variant="secondary" className="mt-2 w-auto" onClick={() => window.location.reload()}>
              Reload the page
            </FormButton>
          ) : null
        }
      />
      <InputField
        control={control}
        name="capacity"
        id={ids.capacity}
        label="Workers you can supply"
        inputMode="numeric"
        description={`The employer needs ${formatCount(workersNeeded)}. You can offer at most ${formatCount(maxCapacity)}.`}
      />
      <InputField control={control} name="availableFrom" id={ids.availableFrom} label="Available from" type="date" description="Today or later, within the next 3 years." />
      <TextareaField
        control={control}
        name="timelineNote"
        id={ids.timelineNote}
        label="Timeline (optional)"
        description={`How and when you would supply the workers. Up to ${formatCount(TIMELINE_MAX)} characters.`}
      />
      <TextareaField
        control={control}
        name="experienceNote"
        id={ids.experienceNote}
        label="Relevant experience"
        description={`Your experience with these occupations and this destination. ${characterCount(experience.length, EXPERIENCE_MAX)}.`}
      />
      <fieldset className="grid gap-5">
        <legend className="mb-1.5 text-h3">The workers&apos; skills (optional)</legend>
        <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
          <ComboboxField
            control={control}
            name="languageCode"
            id={ids.languageCode}
            label="Language"
            placeholder="Choose a language"
            options={languageOptions}
            emptyText="No matching language"
            description="Usually the language of the destination country."
          />
          <SelectField
            control={control}
            name="languageLevel"
            id={ids.languageLevel}
            label="Level, at least"
            placeholder="Choose a level"
            options={levelOptions}
          />
          <InputField
            control={control}
            name="minExperienceYears"
            id={ids.minExperienceYears}
            label="Experience, at least (years)"
            inputMode="numeric"
          />
        </div>
        <TextareaField
          control={control}
          name="certificates"
          id={ids.certificates}
          label="Certificates and tests"
          description={`For example "ISO 9606-1 welders, 3G and 6G, trade-tested". Up to ${formatCount(CERTIFICATES_MAX)} characters.`}
        />
      </fieldset>
      <fieldset className="grid gap-5">
        <legend className="mb-1.5 text-h3">Your proposal</legend>
        <Notice tone="info" role="note">
          {NOT_A_PARTY}. The employer and your company agree the contract and any payment outside the platform.
        </Notice>
        <RadioGroupField control={control} name="feeModel" id={ids.feeModel} legend="Fee model" options={feeOptions} />
        {hasAmount(feeModel) ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <InputField
              control={control}
              name="feeAmount"
              id={ids.feeAmount}
              label={feeModel === "percent_first_year_salary" ? "Percentage" : "Amount"}
              inputMode="decimal"
              description={feeModel === "percent_first_year_salary" ? "Above 0 and at most 100, for example 12.5." : "For example 1500 or 1500.50."}
            />
            {hasCurrency(feeModel) ? (
              <ComboboxField
                control={control}
                name="feeCurrency"
                id={ids.feeCurrency}
                label="Currency"
                placeholder="Choose a currency"
                options={currencyOptions}
                emptyText="No matching currency"
              />
            ) : null}
          </div>
        ) : null}
        <CheckboxGroupField
          control={control}
          name="feeIncludes"
          id={ids.feeIncludes}
          legend="The fee includes (optional)"
          options={inclusionOptions}
        />
        <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
          <InputField
            control={control}
            name="guaranteeDays"
            id={ids.guaranteeDays}
            label="Guarantee period (days, optional)"
            inputMode="numeric"
            description="A free replacement if a worker leaves within it."
          />
          <InputField
            control={control}
            name="leadTimeWeeks"
            id={ids.leadTimeWeeks}
            label="Lead time (weeks, optional)"
            inputMode="numeric"
            description="From the employer's selection to the workers' arrival."
          />
        </div>
        <TextareaField
          control={control}
          name="notes"
          id={ids.notes}
          label="Notes (optional)"
          description={`Anything else the employer should know about your proposal. Up to ${formatCount(NOTES_MAX)} characters.`}
        />
      </fieldset>
      <ResponseDocuments
        slug={slug}
        requirementId={requirementId}
        initial={documents}
        max={documentsMax}
        pollKey={pollKey}
        onSendingChange={setSendingFile}
      />
      {limitReached ? (
        <Notice tone="warning" role="status">
          <UpgradePrompt
            organizationId={organization.id}
            organizationType={organization.type}
            prompt={limitReached}
            billingHref={billingHref}
            canUpgrade={organization.canManage}
            focusUpgrade
          />
        </Notice>
      ) : null}
      <p id={sendingId} role="status" className="text-small text-muted-foreground empty:hidden">
        {sendingFile ? `A document is still being sent. You can ${edit ? "save your changes" : "send your response"} once it has arrived.` : ""}
      </p>
      <div className="flex flex-wrap gap-3">
        <FormButton
          type="submit"
          className="w-auto"
          busy={formState.isSubmitting}
          disabled={blockedBy !== undefined || sendingFile}
          aria-describedby={[blockedBy, sendingFile ? sendingId : undefined].filter(Boolean).join(" ") || undefined}
        >
          {edit ? "Save changes" : "Send response"}
        </FormButton>
      </div>
    </form>
  );
}
