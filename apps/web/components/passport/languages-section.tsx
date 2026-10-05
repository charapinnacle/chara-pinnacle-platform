"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { SelectField } from "@/components/forms/select-field";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { RemoveButton } from "@/components/passport/remove-button";
import { addLanguage, removeLanguage } from "@/lib/actions/passport";
import type { ReferenceItem } from "@/lib/dal/reference";
import { cefrOptions, languageFormSchema } from "@/lib/validation/passport";

type LanguagesSectionProps = {
  languages: { code: string; level: string }[];
  options: ReferenceItem[];
};

export function LanguagesSection({ languages, options }: LanguagesSectionProps) {
  const { form, onSubmit } = usePassportForm(languageFormSchema, { language: "", level: "" }, addLanguage, {
    failureTitle: "Could not add the language",
    saved: "Language added",
    resetOnSuccess: true,
  });
  const nameOf = (code: string) => options.find((option) => option.code === code)?.name ?? code;
  const added = new Set(languages.map(({ code }) => code));

  return (
    <div className="grid gap-5">
      {languages.length === 0 ? (
        <p className="text-body text-muted-foreground">You have not added any languages yet</p>
      ) : (
        <ul className="grid gap-2">
          {languages.map(({ code, level }) => (
            <li key={code} className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-1.5">
              <span className="min-w-0 break-words">
                {nameOf(code)} <span className="text-muted-foreground">({level})</span>
              </span>
              <RemoveButton name={nameOf(code)} removed="Language removed" remove={() => removeLanguage(code)} />
            </li>
          ))}
        </ul>
      )}
      <form noValidate className="grid gap-4" onSubmit={onSubmit}>
        <ComboboxField
          control={form.control}
          name="language"
          label="Language"
          placeholder="Choose a language"
          options={options.filter(({ code }) => !added.has(code)).map(({ code, name }) => ({ value: code, label: name }))}
        />
        <SelectField control={form.control} name="level" label="CEFR level" placeholder="Choose a level" options={cefrOptions} />
        <FormButton type="submit" variant="secondary" busy={form.formState.isSubmitting}>
          Add language
        </FormButton>
      </form>
    </div>
  );
}
