"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useFieldArray, useForm, useWatch, type FieldErrors, type FieldPath, type FieldValues } from "react-hook-form";
import * as z from "zod";
import { toast, toastError } from "@/components/feedback/toast-store";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { ComboboxField } from "@/components/forms/combobox-field";
import { ErrorSummary } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import { summaryItems } from "@/components/forms/summary-items";
import { LegalLink, textLinkVariants } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { saveRequirement } from "@/lib/actions/requirements";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import { formatCount } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import { toOptions } from "@/lib/reference-options";
import { employmentTypeOptions, recruitmentPreferenceOptions, salaryPeriodOptions, salaryPeriods } from "@/lib/validation/job";
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
  occupations: OccupationItem[];
  industries: ReferenceItem[];
  countries: ReferenceItem[];
  currencies: ReferenceItem[];
  edit?: { requirementId: string; values: RequirementFormInput };
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

const occupationId = (index: number) => `requirement-occupation-${index}`;
const quantityId = (index: number) => `requirement-quantity-${index}`;

// What a new requirement keeps in this tab until it is saved (FR-M1 AC12): a draft row needs every field, so a half-filled
// form is kept in the browser, never on the server. Only the values of the form, no person; unreadable storage is ignored.
const draftSchema = z.object({
  title: z.string(),
  workersNeeded: z.string(),
  country: z.string(),
  cityRegion: z.string(),
  industry: z.string(),
  occupations: z.array(z.object({ occupation: z.string(), quantity: z.string() })).min(1).max(OCCUPATIONS_MAX),
  skills: z.string(),
  experienceYears: z.string(),
  startDate: z.string(),
  durationMonths: z.string(),
  employmentType: z.string(),
  salaryMin: z.string(),
  salaryMax: z.string(),
  salaryCurrency: z.string(),
  salaryPeriod: z.union([z.literal(""), z.enum(salaryPeriods)]),
  accommodation: z.boolean(),
  workPermitSupport: z.boolean(),
  visaSupport: z.boolean(),
  recruitmentPreference: z.string(),
  partnerNeed: z.string(),
});

const draftKey = (slug: string) => `chara:requirement-draft:${slug}`;

function readDraft(slug: string): RequirementFormInput | null {
  try {
    const stored = window.sessionStorage.getItem(draftKey(slug));
    if (!stored) return null;
    const parsed = draftSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeDraft(slug: string, values: unknown): void {
  try {
    window.sessionStorage.setItem(draftKey(slug), JSON.stringify(values));
  } catch {
    // Storage that is full or blocked only costs the convenience of a restored draft.
  }
}

function clearDraft(slug: string): void {
  try {
    window.sessionStorage.removeItem(draftKey(slug));
  } catch {
    // As writeDraft.
  }
}

export function RequirementForm({ slug, occupations, industries, countries, currencies, edit }: RequirementFormProps) {
  const form = useForm<RequirementFormInput, unknown, RequirementFormValues>({
    resolver: zodResolver(requirementFormSchema()),
    defaultValues: edit?.values ?? emptyRequirementForm,
  });
  const { control, formState, handleSubmit } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "occupations" });
  const { submit } = useServerFormSubmit(form, { failureTitle: "Could not save the workforce requirement" });
  const router = useRouter();

  const occupationOptions = useMemo(
    () => occupations.map(({ code, label, synonyms }) => ({ value: code, label: `${code} · ${label}`, keywords: synonyms.join(" ") })),
    [occupations],
  );
  const labelOf = useMemo(() => new Map(occupations.map(({ code, label }) => [code, label])), [occupations]);
  const rows = useWatch({ control, name: "occupations" });
  const workers = useWatch({ control, name: "workersNeeded" });
  const total = rows.reduce((sum, row) => sum + (/^\d+$/.test(row.quantity.trim()) ? Number(row.quantity.trim()) : 0), 0);
  const rowName = (index: number) => labelOf.get(rows[index]?.occupation ?? "") ?? `occupation ${index + 1}`;

  useEffect(() => {
    if (edit) return;
    const draft = readDraft(slug);
    if (draft) form.reset(draft);
    return form.subscribe({ formState: { values: true }, callback: ({ values }) => writeDraft(slug, values) });
  }, [edit, form, slug]);

  function clearForm() {
    clearDraft(slug);
    form.reset(emptyRequirementForm);
  }

  function focusField(key: string) {
    form.setFocus((key.startsWith("occupations") && !/\.\d+\./.test(key) ? "occupations.0.occupation" : key) as Path);
  }

  function onValid() {
    return submit(
      () => saveRequirement(slug, edit?.requirementId ?? null, form.getValues()),
      (result) => {
        if (result.savedHref) {
          if (!edit) clearDraft(slug);
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
    ...Object.fromEntries(
      fields.flatMap((field, index) => [
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
        <ComboboxField control={control} name="country" id={ids.country} label="Country" placeholder="Choose a country" options={toOptions(countries)} />
        <InputField control={control} name="cityRegion" id={ids.cityRegion} label="City or region" autoComplete="off" />
        <ComboboxField control={control} name="industry" id={ids.industry} label="Industry" placeholder="Choose an industry" options={toOptions(industries)} />
      </fieldset>

      <fieldset className="grid gap-4" aria-describedby="requirement-occupations-total">
        <legend className="mb-2 text-h2">Occupations</legend>
        <p className="text-small text-muted-foreground">
          One to {OCCUPATIONS_MAX} occupations from the ISCO-08 list. The quantities add up to the number of workers.
        </p>
        <ul className="grid gap-4">
          {fields.map((field, index) => (
            <li key={field.id} className="grid gap-4 rounded-xl border p-card sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-start">
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
              {fields.length > 1 ? (
                <FormButton
                  type="button"
                  variant="secondary"
                  className="gap-1.5 sm:mt-7"
                  aria-label={`Remove ${rowName(index)}`}
                  onClick={() => remove(index)}
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
            disabled={fields.length >= OCCUPATIONS_MAX}
            onClick={() => append({ occupation: "", quantity: "" })}
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
