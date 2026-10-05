"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { ListRow } from "@/components/passport/list-row";
import { addSkill, removeSkill } from "@/lib/actions/passport";
import { skillSuggestions } from "@/lib/passport/skill-suggestions";
import { SKILL_DUPLICATE_MESSAGE, skillFormSchema, validateSkill } from "@/lib/validation/passport";

type Skill = { id: string; name: string };

export function SkillsSection({ skills, max }: { skills: Skill[]; max: number }) {
  const names = skills.map(({ name }) => name);
  const { form, onSubmit } = usePassportForm(
    skillFormSchema,
    { skill: "" },
    async (values) => {
      const checked = validateSkill(names, values.skill, max);
      if (checked.status === "refused") return { errors: { skill: checked.message } };
      if (checked.status === "duplicate") return { errors: { skill: SKILL_DUPLICATE_MESSAGE } };
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
            <ListRow key={skill.id} name={skill.name} removed="Skill removed" remove={() => removeSkill(skill.id)}>
              {skill.name}
            </ListRow>
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
