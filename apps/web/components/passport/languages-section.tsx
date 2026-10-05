"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { SelectField } from "@/components/forms/select-field";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { ListRow } from "@/components/passport/list-row";
import { addLanguage, removeLanguage } from "@/lib/actions/passport";
import type { ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
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
            <ListRow key={code} name={nameOf(code)} removed="Language removed" remove={() => removeLanguage(code)}>
              {nameOf(code)} <span className="text-muted-foreground">({level})</span>
            </ListRow>
          ))}
        </ul>
      )}
      <form noValidate className="grid gap-4" onSubmit={onSubmit}>
        <ComboboxField
          control={form.control}
          name="language"
          label="Language"
          placeholder="Choose a language"
          options={toOptions(options.filter(({ code }) => !added.has(code)))}
        />
        <SelectField control={form.control} name="level" label="CEFR level" placeholder="Choose a level" options={cefrOptions} />
        <FormButton type="submit" variant="secondary" busy={form.formState.isSubmitting}>
          Add language
        </FormButton>
      </form>
    </div>
  );
}
