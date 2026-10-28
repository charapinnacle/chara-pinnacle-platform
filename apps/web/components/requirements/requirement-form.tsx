"use client";

import type { Database } from "@chara-pinnacle/db-types";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch, type FieldErrors, type FieldPath, type FieldValues } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { ComboboxField } from "@/components/forms/combobox-field";
import { ErrorSummary } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import { summaryItems } from "@/components/forms/summary-items";
import { LegalLink, TextLink, textLinkVariants } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { saveRequirement } from "@/lib/actions/requirements";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import type { MultiCountryPlan } from "@/lib/dal/requirements";
import { formatCount } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import { toOptions } from "@/lib/reference-options";
import {
  clearRequirementDraft,
  readRequirementDraft,
  requirementDraftKey,
  writeRequirementDraft,
} from "@/lib/requirements/drafts";
import { ADDITIONAL_COUNTRIES_MAX, multiCountryText } from "@/lib/requirements/limits";
import { employmentTypeOptions, recruitmentPreferenceOptions, salaryPeriodOptions } from "@/lib/validation/job";
import {
  emptyRequirementForm,
  OCCUPATIONS_MAX,
  partnerNeedOptions,
  PROHIBITED_CRITERION,
  requirementFormSchema,
  type RequirementFormInput,
  type RequirementFormValues,
} from "@/lib/validation/requirement";

type RequirementFormProps = {
  slug: string;
  userId: string;
  occupations: OccupationItem[];
  industries: ReferenceItem[];
  countries: ReferenceItem[];
  currencies: ReferenceItem[];
  // Whether the plan offers further destination countries, and which plan does (FR-M4); billingHref leads to a higher
  // plan, for an owner or admin.
  multiCountry: MultiCountryPlan;
  billingHref: string;
  // expectedUpdatedAt is the version the page was loaded with; a save from an older one is refused.
  // status names the next step in the plan notice: a draft is published, a paused requirement reopened.
  edit?: { requirementId: string; values: RequirementFormInput; expectedUpdatedAt: string; status: Database["public"]["Enums"]["requirement_status"] };
};

type Path = FieldPath<RequirementFormInput>;

const ids = {
  title: "requirement-title",
  workersNeeded: "requirement-workers",
  country: "requirement-country",
  cityRegion: "requirement-city-region",
  industry: "requirement-industry",
  skills: "requirement-skills",
  experienceYears: "requirement-experience",
  startDate: "requirement-start-date",
  durationMonths: "requirement-duration",
  employmentType: "requirement-employment-type",
  salaryMin: "requirement-salary-min",
  salaryMax: "requirement-salary-max",
  salaryCurrency: "requirement-salary-currency",
  salaryPeriod: "requirement-salary-period",
  accommodation: "requirement-accommodation",
  workPermitSupport: "requirement-work-permit",
  visaSupport: "requirement-visa",
  recruitmentPreference: "requirement-recruitment-preference",
  partnerNeed: "requirement-partner-need",
} as const;

const destinationId = (index: number) => `requirement-destination-${index}`;
const occupationId = (index: number) => `requirement-occupation-${index}`;
const quantityId = (index: number) => `requirement-quantity-${index}`;

// The list rows keep their own React keys instead of React Hook Form's useFieldArray: Turbopack keeps one react-hook-form
// module for all forms, so useFieldArray would also load with the log-in and sign-up forms, whose chunks the home page
// prefetches (the transferred JavaScript budget of /[lang]).
let lastRowKey = 0;
function rowKeys(count: number): string[] {
  return Array.from({ length: count }, () => `row-${++lastRowKey}`);
}

export function RequirementForm({
  slug,
  userId,
  occupations,
  industries,
  countries,
  currencies,
  multiCountry,
  billingHref,
  edit,
}: RequirementFormProps) {
  const form = useForm<RequirementFormInput, unknown, RequirementFormValues>({
    resolver: zodResolver(requirementFormSchema()),
    defaultValues: edit?.values ?? emptyRequirementForm,
  });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: "Could not save the workforce requirement" });
  const router = useRouter();
  const [removed, setRemoved] = useState("");

  const occupationOptions = useMemo(
    () => occupations.map(({ code, label, synonyms }) => ({ value: code, label: `${code} · ${label}`, keywords: synonyms.join(" ") })),
    [occupations],
  );
  const labelOf = useMemo(() => new Map(occupations.map(({ code, label }) => [code, label])), [occupations]);
  const rows = useWatch({ control, name: "occupations" });
  const workers = useWatch({ control, name: "workersNeeded" });
  const total = rows.reduce((sum, row) => sum + (/^\d+$/.test(row.quantity.trim()) ? Number(row.quantity.trim()) : 0), 0);
  const rowName = (index: number) => labelOf.get(rows[index]?.occupation ?? "") ?? `occupation ${index + 1}`;
  const countryOptions = useMemo(() => toOptions(countries), [countries]);
  const countryName = useMemo(() => new Map(countries.map(({ code, name }) => [code, name])), [countries]);
  const destinations = useWatch({ control, name: "destinations" });
  const destinationName = (index: number) =>
    countryName.get(destinations[index]?.country ?? "") ?? `destination country ${index + 1}`;
  const [occupationKeys, setOccupationKeys] = useState(() => rowKeys(rows.length));
  const [destinationKeys, setDestinationKeys] = useState(() => rowKeys(destinations.length));
  // Adding or removing a row changes the keys with the rows; a reset (a restored draft, Clear the form) gives new keys.
  if (occupationKeys.length !== rows.length) setOccupationKeys(rowKeys(rows.length));
  if (destinationKeys.length !== destinations.length) setDestinationKeys(rowKeys(destinations.length));

  const draftKey = requirementDraftKey(userId, slug);

  useEffect(() => {
    if (edit) return;
    const draft = readRequirementDraft(draftKey);
    if (draft) form.reset(draft);
    return form.subscribe({ formState: { values: true }, callback: ({ values }) => writeRequirementDraft(draftKey, values) });
  }, [draftKey, edit, form]);

  function clearForm() {
    clearRequirementDraft(draftKey);
    form.reset(emptyRequirementForm);
  }

  // After a submit, a changed list is checked again, as React Hook Form does when a field changes.
  const listChange = () => ({ shouldDirty: true, shouldValidate: form.formState.isSubmitted });

  function addRow() {
    const next = [...form.getValues("occupations"), { occupation: "", quantity: "" }];
    form.setValue("occupations", next, listChange());
    setOccupationKeys((keys) => [...keys, ...rowKeys(1)]);
    requestAnimationFrame(() => form.setFocus(`occupations.${next.length - 1}.occupation`));
  }

  function addDestination() {
    const next = [...form.getValues("destinations"), { country: "" }];
    form.setValue("destinations", next, listChange());
    setDestinationKeys((keys) => [...keys, ...rowKeys(1)]);
    requestAnimationFrame(() => form.setFocus(`destinations.${next.length - 1}.country`));
  }

  // The row before the removed one (or the new first row) takes the focus, and the removal is announced.
  function removeRow(index: number) {
    const label = rowName(index);
    form.setValue("occupations", form.getValues("occupations").filter((_, i) => i !== index), listChange());
    setOccupationKeys((keys) => keys.filter((_, i) => i !== index));
    setRemoved(`Removed ${label}`);
    requestAnimationFrame(() => form.setFocus(`occupations.${Math.max(index - 1, 0)}.occupation`));
  }

  function removeDestination(index: number) {
    const label = destinationName(index);
    form.setValue("destinations", form.getValues("destinations").filter((_, i) => i !== index), listChange());
    setDestinationKeys((keys) => keys.filter((_, i) => i !== index));
    setRemoved(`Removed ${label}`);
    requestAnimationFrame(() =>
      index > 0 ? form.setFocus(`destinations.${index - 1}.country`) : document.getElementById("requirement-add-destination")?.focus(),
    );
  }

  function focusField(key: string) {
    if (key === "destinations.root" || key === "destinations") {
      document.getElementById(destinationKeys.length > 0 ? destinationId(0) : "requirement-destinations-heading")?.focus();
      return;
    }
    form.setFocus((key.startsWith("occupations") && !/\.\d+\./.test(key) ? "occupations.0.occupation" : key) as Path);
  }

  function onValid() {
    return submit(
      () => saveRequirement(slug, edit ? { id: edit.requirementId, expectedUpdatedAt: edit.expectedUpdatedAt } : null, form.getValues()),
      (result) => {
        if (result.savedHref) {
          if (!edit) clearRequirementDraft(draftKey);
          toast({ title: edit ? "Workforce requirement saved" : "Draft saved" });
          router.push(result.savedHref);
          return;
        }
        if (result.message) toastError("Could not save the workforce requirement", result.message);
        const [first] = Object.keys(result.errors ?? {});
        if (first) focusField(first);
      },
    );
  }

  // The occupation list's own error is linked to the first occupation, so the ids are not only the form's field paths.
  const summaryIds: Record<string, string> = {
    title: ids.title,
    workersNeeded: ids.workersNeeded,
    country: ids.country,
    cityRegion: ids.cityRegion,
    industry: ids.industry,
    ...Object.fromEntries(destinationKeys.map((key, index) => [`destinations.${index}.country`, destinationId(index)])),
    "destinations.root": destinationKeys.length > 0 ? destinationId(0) : "requirement-destinations-heading",
    ...Object.fromEntries(
      occupationKeys.flatMap((key, index) => [
        [`occupations.${index}.occupation`, occupationId(index)],
        [`occupations.${index}.quantity`, quantityId(index)],
      ]),
    ),
    "occupations.root": occupationId(0),
    skills: ids.skills,
    experienceYears: ids.experienceYears,
    startDate: ids.startDate,
    durationMonths: ids.durationMonths,
    employmentType: ids.employmentType,
    salaryMin: ids.salaryMin,
    salaryMax: ids.salaryMax,
    salaryCurrency: ids.salaryCurrency,
    salaryPeriod: ids.salaryPeriod,
    recruitmentPreference: ids.recruitmentPreference,
    partnerNeed: ids.partnerNeed,
  };
  const listError = formState.errors.occupations?.root?.message ?? formState.errors.occupations?.message;
  const destinationsError = formState.errors.destinations?.root?.message ?? formState.errors.destinations?.message;
  const errors: FieldErrors = formState.errors;
  const workersCount = /^\d+$/.test(workers.trim()) ? Number(workers.trim()) : null;

  return (
    <form noValidate className="grid gap-8" onSubmit={handleSubmit(onValid)}>
      <ErrorSummary items={summaryItems<FieldValues>(errors, summaryIds)} onSelect={focusField} />
      <Notice tone="info">
        A workforce requirement describes one need for a group of workers; candidates do not apply to it. It must follow the{" "}
        <LegalLink slug="platform-rules" newTabLabel="(opens in a new tab)">
          Platform Rules
        </LegalLink>{" "}
        and may not ask for gender, age, nationality, religion, marital status or other personal characteristics.
      </Notice>

      <fieldset className="grid gap-6">
        <legend className="mb-4 text-h2">Workers and place</legend>
        <InputField
          control={control}
          name="title"
          id={ids.title}
          label="Title (optional)"
          description="Leave it empty and we write one from the workers, the occupations and the place."
          autoComplete="off"
        />
        <InputField control={control} name="workersNeeded" id={ids.workersNeeded} label="Number of workers" inputMode="numeric" />
        <ComboboxField control={control} name="country" id={ids.country} label="Country" placeholder="Choose a country" options={countryOptions} />
        <InputField control={control} name="cityRegion" id={ids.cityRegion} label="City or region" autoComplete="off" />
        <ComboboxField control={control} name="industry" id={ids.industry} label="Industry" placeholder="Choose an industry" options={toOptions(industries)} />
      </fieldset>

      <fieldset className="grid gap-4" aria-describedby={destinationsError ? "requirement-destinations-error" : undefined}>
        <legend id="requirement-destinations-heading" tabIndex={-1} className="mb-2 text-h2">
          Further destination countries
        </legend>
        <p className="text-small text-muted-foreground">
          The country above is the main destination.
          {multiCountry.allowed ? ` If the workers are needed in several countries, add up to ${ADDITIONAL_COUNTRIES_MAX} more.` : null}
        </p>
        {destinationKeys.length > 0 ? (
          <ul className="grid gap-4">
            {destinationKeys.map((key, index) => (
              <li key={key} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <ComboboxField
                  control={control}
                  name={`destinations.${index}.country`}
                  id={destinationId(index)}
                  label={`Destination country ${index + 2}`}
                  placeholder="Choose a country"
                  options={countryOptions}
                />
                <FormButton
                  type="button"
                  variant="secondary"
                  className="gap-1.5 sm:mt-7"
                  aria-label={`Remove ${destinationName(index)}`}
                  onClick={() => removeDestination(index)}
                >
                  <X aria-hidden className="size-4" />
                  Remove
                </FormButton>
              </li>
            ))}
          </ul>
        ) : null}
        {destinationsError ? (
          <p className="text-small font-medium text-destructive" id="requirement-destinations-error">
            {destinationsError}
          </p>
        ) : null}
        {multiCountry.allowed ? (
          <div>
            <FormButton
              type="button"
              variant="secondary"
              id="requirement-add-destination"
              className="gap-2"
              disabled={destinationKeys.length >= ADDITIONAL_COUNTRIES_MAX}
              onClick={addDestination}
            >
              <Plus aria-hidden className="size-4" />
              Add destination country
            </FormButton>
          </div>
        ) : (
          <Notice tone="info">
            {multiCountryText(multiCountry.planName)}{" "}
            {destinationKeys.length > 0
              ? `Remove the further destinations to ${!edit || edit.status === "draft" ? "publish" : "reopen"} this requirement on your plan. `
              : null}
            <TextLink href={billingHref}>Upgrade</TextLink>
          </Notice>
        )}
      </fieldset>

      <fieldset
        className="grid gap-4"
        aria-describedby={listError ? "requirement-occupations-total requirement-occupations-error" : "requirement-occupations-total"}
      >
        <legend className="mb-2 text-h2">Occupations</legend>
        <p className="text-small text-muted-foreground">
          One to {OCCUPATIONS_MAX} occupations from the ISCO-08 list. The quantities add up to the number of workers.
        </p>
        <ul className="grid gap-4">
          {occupationKeys.map((key, index) => (
            <li key={key} className="grid gap-4 rounded-xl border p-card sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-start">
              <ComboboxField
                control={control}
                name={`occupations.${index}.occupation`}
                id={occupationId(index)}
                label={`Occupation ${index + 1}`}
                placeholder="Search for an occupation"
                emptyText="No matching occupation"
                options={occupationOptions}
              />
              <InputField
                control={control}
                name={`occupations.${index}.quantity`}
                id={quantityId(index)}
                label={`Quantity of ${rowName(index)}`}
                inputMode="numeric"
              />
              {occupationKeys.length > 1 ? (
                <FormButton
                  type="button"
                  variant="secondary"
                  className="gap-1.5 sm:mt-7"
                  aria-label={`Remove ${rowName(index)}`}
                  onClick={() => removeRow(index)}
                >
                  <X aria-hidden className="size-4" />
                  Remove
                </FormButton>
              ) : null}
            </li>
          ))}
        </ul>
        <p id="requirement-occupations-total" aria-live="polite" className="text-small text-muted-foreground">
          {workersCount === null
            ? `Total: ${formatCount(total)} workers`
            : `Total: ${formatCount(total)} of ${formatCount(workersCount)} workers`}
        </p>
        <p aria-live="polite" className="sr-only">
          {removed}
        </p>
        {listError ? (
          <p className="text-small font-medium text-destructive" id="requirement-occupations-error">
            {listError}
          </p>
        ) : null}
        <div>
          <FormButton
            type="button"
            variant="secondary"
            className="gap-2"
            disabled={occupationKeys.length >= OCCUPATIONS_MAX}
            onClick={addRow}
          >
            <Plus aria-hidden className="size-4" />
            Add occupation
          </FormButton>
        </div>
      </fieldset>

      <fieldset className="grid gap-6">
        <legend className="mb-4 text-h2">Work</legend>
        <TextareaField
          control={control}
          name="skills"
          id={ids.skills}
          label="Skills (optional)"
          description="Up to 1,000 characters, for example MIG/MAG welding, blueprint reading."
        />
        {formState.errors.skills?.message === PROHIBITED_CRITERION ? (
          <Notice tone="error">
            Describe the work and the skills it needs. See the{" "}
            <LegalLink slug="platform-rules" newTabLabel="(opens in a new tab)">
              Platform Rules
            </LegalLink>
            .
          </Notice>
        ) : null}
        <InputField control={control} name="experienceYears" id={ids.experienceYears} label="Experience in years (optional)" inputMode="numeric" />
        <InputField control={control} name="startDate" id={ids.startDate} label="Start date" type="date" />
        <InputField
          control={control}
          name="durationMonths"
          id={ids.durationMonths}
          label="Project duration in months (optional)"
          description="Leave it empty for permanent or open-ended work."
          inputMode="numeric"
        />
        <SelectField
          control={control}
          name="employmentType"
          id={ids.employmentType}
          label="Employment type"
          placeholder="Choose an employment type"
          options={employmentTypeOptions}
        />
      </fieldset>

      <fieldset className="grid gap-6 sm:grid-cols-2">
        <legend className="mb-4 text-h2">Salary or budget (optional)</legend>
        <InputField control={control} name="salaryMin" id={ids.salaryMin} label="Salary minimum" inputMode="decimal" />
        <InputField control={control} name="salaryMax" id={ids.salaryMax} label="Salary maximum" inputMode="decimal" />
        <ComboboxField
          control={control}
          name="salaryCurrency"
          id={ids.salaryCurrency}
          label="Currency"
          placeholder="Choose a currency"
          options={currencies.map(({ code, name }) => ({ value: code, label: `${code} · ${name}` }))}
        />
        <SelectField
          control={control}
          name="salaryPeriod"
          id={ids.salaryPeriod}
          label="Pay period"
          placeholder="Choose a pay period"
          options={salaryPeriodOptions}
        />
      </fieldset>

      <fieldset className="grid">
        <legend className="mb-4 text-h2">Support</legend>
        <CheckboxField control={control} name="accommodation" id={ids.accommodation}>
          Accommodation provided
        </CheckboxField>
        <CheckboxField control={control} name="workPermitSupport" id={ids.workPermitSupport}>
          Work permit support offered
        </CheckboxField>
        <CheckboxField control={control} name="visaSupport" id={ids.visaSupport}>
          Visa support offered
        </CheckboxField>
      </fieldset>

      <fieldset className="grid gap-6">
        <legend className="mb-4 text-h2">Recruitment</legend>
        <SelectField
          control={control}
          name="recruitmentPreference"
          id={ids.recruitmentPreference}
          label="Recruitment preference"
          placeholder="Choose a recruitment preference"
          options={recruitmentPreferenceOptions}
        />
        <SelectField
          control={control}
          name="partnerNeed"
          id={ids.partnerNeed}
          label="Need workforce partners?"
          placeholder="Choose an answer"
          options={partnerNeedOptions}
        />
      </fieldset>

      <div className="grid gap-3">
        <FormButton type="submit" busy={formState.isSubmitting}>
          {formState.isSubmitting ? "Saving..." : edit ? "Save changes" : "Save draft"}
        </FormButton>
        {edit ? null : (
          <p className="text-small text-muted-foreground">
            What you enter is kept in this browser tab until you save it.{" "}
            <button type="button" className={cn("cursor-pointer", textLinkVariants())} onClick={clearForm}>
              Clear the form
            </button>
          </p>
        )}
      </div>
    </form>
  );
}
