"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { RemoveButton } from "@/components/passport/remove-button";
import { addSkill, removeSkill } from "@/lib/actions/passport";
import { skillSuggestions } from "@/lib/passport/skill-suggestions";
import { skillFormSchema, validateSkill } from "@/lib/validation/passport";

type Skill = { id: string; name: string };

export function SkillsSection({ skills }: { skills: Skill[] }) {
  const names = skills.map(({ name }) => name);
  const { form, onSubmit } = usePassportForm(
    skillFormSchema,
    { skill: "" },
    async (values) => {
      const checked = validateSkill(names, values.skill);
      if (checked.status === "refused") return { errors: { skill: checked.message } };
      if (checked.status === "duplicate") return { errors: { skill: "You have already added this skill." } };
      return addSkill(values);
    },
    { failureTitle: "Could not add the skill", saved: "Skill added", resetOnSuccess: true },
  );
  const taken = new Set(names.map((name) => name.toLowerCase()));
  const options = skillSuggestions
    .filter((suggestion) => !taken.has(suggestion.toLowerCase()))
    .map((suggestion) => ({ value: suggestion, label: suggestion }));

  return (
    <div className="grid gap-5">
      {skills.length === 0 ? (
        <p className="text-body text-muted-foreground">You have not added any skills yet</p>
      ) : (
        <ul className="grid gap-2">
          {skills.map((skill) => (
            <li key={skill.id} className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-1.5">
              <span className="min-w-0 break-words">{skill.name}</span>
              <RemoveButton name={skill.name} removed="Skill removed" remove={() => removeSkill(skill.id)} />
            </li>
          ))}
        </ul>
      )}
      <form noValidate className="grid gap-4" onSubmit={onSubmit}>
        <ComboboxField
          freeText
          control={form.control}
          name="skill"
          label="Skills"
          description="Pick a suggestion or type your own, one skill at a time."
          placeholder="For example Welding"
          options={options}
        />
        <FormButton type="submit" variant="secondary" busy={form.formState.isSubmitting}>
          Add skill
        </FormButton>
      </form>
    </div>
  );
}
